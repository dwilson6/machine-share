#! /usr/bin/env node


var fs = require('fs')
var path = require('path')
var fse = require('fs.extra')
var zip = require('node-zip')
var util = require('./util')

var args = process.argv.slice(2)
var machineZip = args[0]
if (!machineZip) {
    console.log('machine-import <config-zip>')
    process.exit(1)
}
var machine = path.basename(machineZip)
machine = machine.substring(0, machine.length - 4)

var machineStoragePath = process.env.HOME + '/.docker/machine'
if(process.env.MACHINE_STORAGE_PATH) {
    machineStoragePath = process.env.MACHINE_STORAGE_PATH
}
var configDir = machineStoragePath + '/machines/' + machine
var certDir = machineStoragePath + '/certs/' + machine
if(dirExists(configDir)) {
    if(machineArchiveHasChanged()) {
        console.log('that machine exists but the archive has changed, importing ' + machine)
    } else {
        console.log('that machine already exists, skipping ' + machine)
        process.exit(1)
    }
} else {
    console.log('importing ' + machine)
}

var tmp = '/tmp/' + machine + '/'
fse.rmrfSync(tmp)

unzip()
processConfig()

util.copyDir(tmp, configDir)
util.copyDir(tmp + 'certs', certDir)
fse.rmrfSync(tmp)


function dirExists(dirName) {
    try {
        fs.statSync(configDir)
    } catch (e) {
        return false
    }
    return true
}

function machineArchiveHasChanged() {
    var zip = new require('node-zip')()
    zip.load(fs.readFileSync(machineZip))
    for (var f in zip.files) {
        var file = zip.files[f]
        if (!file.dir) {
            var existingFilePath;
            if(file.name.indexOf('certs') == 0) {
                existingFilePath=certDir + '/' + file.name.split('/')[1]
            } else {
                existingFilePath=configDir + '/' + file.name
            }
            var existingFile;
            try {
                existingFile=fs.readFileSync(existingFilePath)
            } catch(err) {
                console.log(existingFilePath + ' does not exist')
                return true
            }
            var newFileContent=file.asNodeBuffer().toString()
            if(file.name == 'config.json') {
                newFileContent=renderConfig(newFileContent)
            }
            if(existingFile.toString() !== newFileContent) {
                console.log(file.name + ' has changed')
                return true
            } 
        }
    }
    return false
}

function unzip() {
    var zip = new require('node-zip')()
    zip.load(fs.readFileSync(machineZip))
    for (var f in zip.files) {
        var file = zip.files[f]
        if (!file.dir) {
            util.mkdir(path.dirname(tmp + file.name))
            fs.writeFileSync(tmp + file.name, file.asNodeBuffer())
        }
    }
}

function processConfig() {
    var configName = tmp + 'config.json';
    var configFile = fs.readFileSync(configName)

    fs.writeFileSync(configName, renderConfig(configFile.toString()))
}


function renderConfig(configString) {
    var awsAccessKey = process.env['AWS_ACCESS_KEY_ID']
    var awsSecretKey = process.env['AWS_SECRET_ACCESS_KEY']
    var config = JSON.parse(configString)

    util.recurseJson(config, function (parent, key, value) {
        if (typeof value === 'string') {
            parent[key] = value
                .replace('{{MACHINE_STORAGE_PATH}}', machineStoragePath)
                .replace('{{AWS_ACCESS_KEY_ID}}', awsAccessKey)
                .replace('{{AWS_SECRET_ACCESS_KEY}}', awsSecretKey)
        }
    })

    var raw = config.RawDriver
    if (raw) {
        var decoded = new Buffer(raw, 'base64').toString()
        var driver = JSON.parse(decoded)

        // update store path
        driver.StorePath = machineStoragePath

        var updatedBlob = new Buffer(JSON.stringify(driver)).toString('base64')

        // update old config
        config.RawDriver = updatedBlob
    }


    return JSON.stringify(config)
}
