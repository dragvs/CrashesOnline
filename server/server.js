var http = require("http");
var url = require("url");
var sys = require("sys");
var events = require("events");
var util = require('util');
var crypto = require('crypto');
var path = require('path')
var fs   = require('fs');
var exec = require('child_process').exec;
// third-party:
var formidable = require('formidable');
var mkdirp = require('mkdirp');
var async = require('async');
var archiver = require('archiver');


var server = http.createServer(function(req, res) {
    // Simple path-based request dispatcher
    switch (url.parse(req.url).pathname) {
        case '/manual':
            display_form(req, res); // TODO remove test form UI
            break;
        case '/ucl':
            uploadClientLib(req, res);
            break;
        case '/ucd':
            uploadClientDump(req, res);
            break;
        case '/get':
            sendBackSymbolsAndCrashes(req, res);
            break;
        case '/report':
            showCrashReport(req, res);
            break;
        default:
            sendTextResponse(res, "You'r doing it wrong!", 404);
            break;
    }
});

var configFilePath = __dirname + '/config.json';
var configData;

var clientsFilePath;
var clientsData;

var dumpSymsToolPath;
var symbolicationToolPath;

var workingFolderPath;
var symbolsFolderPath;
var clientLibTargetPath;
var clientLibTempPath;
var clientDumpTargetPath;
var clientDumpTempPath;


main();

function makeFullPath(configPath) {
    // TODO check if 'configPath' is absolute already 
    return __dirname + "/" + configPath;
}

function readClientsConfig(callback) {
    fs.readFile(clientsFilePath, 'utf8', function (err, data) {
        if (err) {
            console.log('Error reading clients config file: ' + err);
            callback(err);
            return;
        }
     
        clientsData = JSON.parse(data);
        console.log("Clients config data: ");
        console.dir(clientsData);

        callback(null);
    });
}

function readServerConfig(callback) {
    fs.readFile(configFilePath, 'utf8', function (err, data) {
        if (err) {
            console.log('Error reading server config file: ' + err);
            callback(err);
            return;
        }
     
        configData = JSON.parse(data);
        console.log("Server config data: ");
        console.dir(configData);

        // Parse config & Prepare folders
        clientsFilePath         = makeFullPath(configData["clientsFilePath"]);
        
        dumpSymsToolPath        = makeFullPath(configData["dumpSymsToolPath"]);
        symbolicationToolPath   = makeFullPath(configData["symbolicationToolPath"]);

        workingFolderPath       = makeFullPath(configData["workingFolderPath"]);
        symbolsFolderPath       = workingFolderPath + "/" + configData["symbolsFolderPath"];
        clientLibTargetPath     = workingFolderPath + "/" + configData["clientLibTargetPath"];
        clientLibTempPath       = workingFolderPath + "/" + configData["clientLibTempPath"];
        clientDumpTargetPath    = workingFolderPath + "/" + configData["clientDumpTargetPath"];
        clientDumpTempPath      = workingFolderPath + "/" + configData["clientDumpTempPath"];

        checkAndCreateDir(symbolsFolderPath);
        checkAndCreateDir(clientLibTargetPath);
        checkAndCreateDir(clientLibTempPath);
        checkAndCreateDir(clientDumpTargetPath);
        checkAndCreateDir(clientDumpTempPath);

        // Clients config
        readClientsConfig(function(err) {
            if (err) {
                console.log('Error reading clients config: ' + err);
                callback(err);
                return;
            }

            callback(null);
        });
    });
}

function main() {
    console.log("New API key: " + generateApiKey());

    readServerConfig(function(err) {
        if (err) {
            console.log('Error reading server config: ' + err);
            return;
        }

        // Server would listen on port 80
        server.listen(80);
    });
}

function checkAndCreateDir(path) {
    if (!fs.existsSync(path)) {
        // fs.mkdirSync(path);
        mkdirp.sync(path);
        console.log("Created dir: " + path);
    }
}

function getFileNameWithoutExt(filePath) {
    var extname = path.extname(filePath);
    var filename = path.basename(filePath, extname);
    return filename;
}

/*
 * Display upload form
 */
function display_form(request, response) {
    console.log("::display_form called");

    var body = '<h1>Hello!</h1>'+
        '<form action="/ucl" method="post" enctype="multipart/form-data">'+
        '<input type="text" name="apiKey" style="width: 750px;" value="Itp9g4219uvmPxXYUmR546VjbXrJGknhdh5GY72gUoGxujzHbczj31PNKsXE25rYCS0ukQyGyCOX9IbszYzq3A=="><br/>'+
        '<input type="text" name="appId" style="width: 250px;" value="com.redsteep.simpleapp"><br/>'+
        '<input type="text" name="appVersion" value="1.0 dev-1"><br/>'+
        '<input type="file" name="upload-file" style="width: 400px;">'+
        '<input type="submit" value="Upload">'+
        '</form>';
    sendHtmlResponse(response, body, 200);
}

function createIncomingForm(uploadDir) {
    var form = new formidable.IncomingForm();
    form.uploadDir = uploadDir;

    form.on('fileBegin', function(name, file) {
        console.log("Form on File begin: " + file.name);
    });

    form.on('progress', function(bytesReceived, bytesExpected) {
        var progress = (bytesReceived / bytesExpected * 100).toFixed(2);
        var receivedKb = (bytesReceived / 1024).toFixed(1);
        var expectedKb = (bytesExpected / 1024).toFixed(1);
     
        console.log("Form Uploading " + receivedKb + " Kb of " + expectedKb + " Kb (" + progress + "%)");
    });

    form.on('error', function(err) {
        console.error("Form error: " + err);
    });
    return form;
}

/*
 * Handle file upload
 */
function uploadClientLib(request, response) {
    // if (request.method.toLowerCase() == 'post')

    var uploadTargetPath = clientLibTargetPath;

    var form = createIncomingForm(clientLibTempPath);

    form.parse(request, function(err, fields, files) {
        console.log("Form[client lib] on Parse");

        var apiKey = fields['apiKey'];
        var appId = fields['appId'];
        var appVersion = fields['appVersion'];

        console.log("   API key: " + apiKey);
        console.log("   App id: " + appId);
        console.log("   App version: " + appVersion);

        var appConfig = findClientConfig(apiKey) //clientsData[apiKey];
        
        if (!appConfig || appConfig.appId != appId) {
            sendTextResponse(response, "ApiKey or App id is incorrect!", 403);
            return;
        }
        if (!appConfig.libUpload) {
            sendTextResponse(response, "Lib upload is restricted!", 403);
            return;
        }

        // Write META
        var file = files['upload-file'];
        var tmpFileName = getFileNameWithoutExt(file.path);

        var metaData = getClientMeta(fields, appConfig, appVersion);
        var metaFilePath = uploadTargetPath + "/" + file.name + "." + tmpFileName + ".meta";

        fs.writeFile(metaFilePath, metaData, function (err2) {
            if (err2) {
                console.error("Saving client lib META error: " + err2);
            } else {
                console.log('Client lib META saved');
            }

            // TODO Run in parallel and wait for the operations to complete before 'processClientLib' call
            // Write file
            var newFilePath = uploadTargetPath + "/" + file.name + "." + tmpFileName;
            console.log("   File target path " + newFilePath);

            fs.rename(file.path, newFilePath, function(err2) {  
                if (err2) {
                    console.error("File rename error: " + err2);
                } else {
                    processClientLib(newFilePath, metaFilePath);
                    console.log("Uploaded tmp file renamed");
                }
            });
        });

        // Render response
        sendTextResponse(response, "Operation: OK", 200);
    });
}

function processClientLib(libPath, metaFilePath) {
    var symFilePath = libPath + ".sym";
    var command = dumpSymsToolPath + " " + libPath + " > " + symFilePath;

    console.log("::processClientLib executing dump_syms command: " + command);

    var child1 = exec(command, function (error, stdout, stderr) {
        console.log("::processClientLib dump_syms exec finished");

        if (error !== null) {
            console.error('::processClientLib dump_syms exec error: ' + error);
            console.log("::processClientLib dump_syms exec stderr: " + stderr);
        } else {
            console.log("::processClientLib dump_syms exec stderr: " + stderr);

            var headCommand = "head -n1 " + symFilePath;
            console.log("::processClientLib executing head command: " + headCommand);

            var child2 = exec(headCommand, function(error, stdout, stderr) {
                console.log("::processClientLib head exec finished");
                console.log("::processClientLib head exec stdout: " + stdout);
                console.log("::processClientLib head exec stderr: " + stderr);

                if (error !== null) {
                    console.error('::processClientLib head exec error: ' + error);
                } else {
                    // MODULE <OS> <arch> <so_uuid> <so_name>
                    var headerArr = stdout.split(" ");

                    if (headerArr.length != 5)
                        console.error('Expected sym file header with 5 elements, found: ' + headerArr.length);
                    if (headerArr[0] != "MODULE")
                        console.error("Expected 'MODULE' field in sym file header, found: " + headerArr[0]);

                    var os = headerArr[1];
                    var arch = headerArr[2];
                    var soUuid = headerArr[3];
                    var soName = headerArr[4];

                    console.log("SYM file header: " + os + " " + arch + " " + soUuid + " " + soName);

                    var soFileName = getFileNameWithoutExt(libPath);

                    // symbols/<so_name>/<so_uuid>/<so_name>.sym
                    var symFileFolderPath = symbolsFolderPath + "/" + soFileName + "/" + soUuid;
                    var symFileTargetPath = symFileFolderPath + "/" + soFileName + ".sym";

                    console.log("SYM file target path: " + symFileTargetPath);

                    var metaFileName = path.basename(metaFilePath);
                    var metaFileTargetPath = symFileFolderPath + "/" + metaFileName;

                    if (fs.existsSync(symFileTargetPath)) {
                        var newStat = fs.statSync(symFilePath);
                        var oldStat = fs.statSync(symFileTargetPath);

                        if (newStat.size == oldStat.size) {
                            console.log("Found SYM file with same UUID (" + soUuid + 
                                ") and file size: " + oldStat.size + " bytes");

                            // Error handling should be added
                            fs.createReadStream(metaFilePath).pipe(fs.createWriteStream(metaFileTargetPath));
                        } else {
                            console.log("ERROR: Found SYM file with same UUID (" + soUuid + 
                                ") but different size: " + newStat.size + " bytes instead of " + 
                                oldStat.size + " bytes");

                            // Error handling should be added
                            fs.createReadStream(metaFilePath).pipe(
                                fs.createWriteStream(metaFileTargetPath + ".error"));
                        }
                    } else {
                        checkAndCreateDir(symFileFolderPath);

                        fs.rename(symFilePath, symFileTargetPath, function(err2) {  
                            if (err2) {
                                console.error("Failed to move SYM file to target path: " + err2);
                            } else {
                                console.log("SYM file moved to target path: " + symFileTargetPath);
                            }
                        });

                        // Error handling should be added
                        fs.createReadStream(metaFilePath).pipe(fs.createWriteStream(metaFileTargetPath));
                    }
                }
            });
        }
    });
}

/*
 * Handle dump upload
 */
function uploadClientDump(request, response) {
    // if (request.method.toLowerCase() == 'post')

    var uploadTargetPath = clientDumpTargetPath;

    var form = createIncomingForm(clientDumpTempPath);

    form.parse(request, function(err, fields, files) {
        console.log("Form[client dump] on Parse");

        var apiKey = fields['apiKey'];
        var appId = fields['appId'];
        var appVersion = fields['appVersion'];

        console.log("   API key: " + apiKey);
        console.log("   App id: " + appId);
        console.log("   App version: " + appVersion);

        var appConfig = findClientConfig(apiKey) //clientsData[apiKey];
        
        if (!appConfig || appConfig.appId != appId) {
            sendTextResponse(response, "ApiKey or App id is incorrect!", 403);
            return;
        }
        if (!appConfig.dumpUpload) {
            sendTextResponse(response, "Dump upload is restricted!", 403);
            return;
        }

        // Write META
        var file = files['upload-file'];
        var tmpFileName = getFileNameWithoutExt(file.path);

        var appSubdirPath = uploadTargetPath + "/" + appConfig.description;
        checkAndCreateDir(appSubdirPath);

        var metaData = getClientMeta(fields, appConfig, appVersion);
        var metaFilePath = appSubdirPath + "/" + file.name + "." + tmpFileName + ".meta";

        fs.writeFile(metaFilePath, metaData, function (err2) {
            if (err2) {
                console.error("Saving client dump META error: " + err2);
            } else {
                console.log('Client dump META saved');
            }
        });

        // Write file
        var newFilePath = appSubdirPath + "/" + file.name + "." + tmpFileName;
        console.log("   File target path " + newFilePath);

        fs.rename(file.path, newFilePath, function(err2) {  
            if (err2) {
                console.error("File rename error: " + err2);
            } else {
                console.log("Uploaded tmp file renamed");
            }
        });

        // Render response
        sendTextResponse(response, "Operation: OK", 200);
    });
}

/*
 * Send back to the caller compressed symbols and crash dumps data
 */
function sendBackSymbolsAndCrashes(request, response) {
    console.log("::sendBackSymbolsAndCrashes begin");

    var archive = archiver('zip');
    archive.pipe(response);

    addDirToArchive(archive, clientDumpTargetPath, function(err) {
        if (err) {
            console.error("::sendBackSymbolsAndCrashes Zipping crash dumps error: " + err);
            return;
        }

        addDirToArchive(archive, symbolsFolderPath, function(err2) {
            if (err2) {
                console.error("::sendBackSymbolsAndCrashes Zipping symbols error: " + err2);
                return;
            }

            archive.finalize();  
            console.log("::sendBackSymbolsAndCrashes ZIP finalized");
        });
    });

    console.log("::sendBackSymbolsAndCrashes end");
}

function addDirToArchive(archive, dirPath, callback) {
    var parentDirPath = path.dirname(dirPath);
    var dirName = path.basename(dirPath);

    listFilesRecursively(dirPath, dirName + "/", function(err, files) {
        if (err) {
            callback(err);
            return;
        }

        function zipFile(fileRelPath, zipCallback) {
            // console.log("::addDirToArchive Zipping file: " + fileRelPath);

            var fileAbsPath = parentDirPath + "/" + fileRelPath;
            archive.append(fs.createReadStream(fileAbsPath), { name: fileRelPath });

            zipCallback(null);
        }

        async.eachSeries(files, zipFile, function(err2) {
            if (err2) {
                callback(err2);
                return;
            }
            callback(null);
        });
    });
}

/*
 * Show crash report
 */
function showCrashReport(request, response) {
    console.log("::showCrashReport begin");

    var dumpFilePath = clientDumpTargetPath + "/hotd3amznfree/1.dmp";
    var command = symbolicationToolPath + " " + dumpFilePath + " " + symbolsFolderPath;

    var child1 = exec(command, function(err, stdout, stderr) {
        console.log("::showCrashReport crash report exec finished");

        if (err) {
            console.error("::showCrashReport dump_syms exec error: " + error);
            console.error("::showCrashReport dump_syms exec stderr: " + stderr);
            // TODO send error response
            return;
        }

        sendTextResponse(response, stdout, 200);
    });
}

function listFilesRecursively(dirPath, subdirPath, doneCallback) {
    var files = [];

    fs.readdir(dirPath, function(err, entryArr) {
        if (err) {
            doneCallback(err, files);
            return;
        }

        var pending = entryArr.length;
        if (!pending) 
            return doneCallback(null, files);

        entryArr.forEach(function(entryName) {
            var entryPath = dirPath + '/' + entryName;

            fs.stat(entryPath, function(err, stat) {
                if (stat && stat.isDirectory()) {
                    listFilesRecursively(entryPath, subdirPath + entryName + "/", function(err, res) {
                        files = files.concat(res);
                        if (!--pending) doneCallback(null, files);
                    });
                } else if (stat && stat.isFile()) {
                    files.push(subdirPath + entryName);
                    if (!--pending) doneCallback(null, files);
                } else {
                    --pending;
                }
            });
        });
    });
}


function getClientMeta(fields, appConfig, appVersion) {
    var meta = "ApiKey: " + appConfig.apiKey + "\n";
    meta += "AppId: " + appConfig.appId + "\n";
    meta += "AppVersion: " + appVersion + "\n";

    meta += "ID: " + fields['meta.ID'] + "\n";
    meta += "MANUFACTURER: " + fields['meta.MANUFACTURER'] + "\n";
    meta += "MODEL: " + fields['meta.MODEL'] + "\n";
    meta += "PRODUCT: " + fields['meta.PRODUCT'] + "\n";
    meta += "VERSION.CODENAME: " + fields['meta.VERSION.CODENAME'] + "\n";
    meta += "VERSION.INCREMENTAL: " + fields['meta.VERSION.INCREMENTAL'] + "\n";
    meta += "VERSION.RELEASE: " + fields['meta.VERSION.RELEASE'] + "\n";
    meta += "VERSION.SDK_INT: " + fields['meta.VERSION.SDK_INT'];
    return meta;
}

function sendTextResponse(response, text, statusCode) {
    statusCode = typeof statusCode !== 'undefined' ? statusCode : 200;

    response.writeHead(statusCode, {
      'Content-Length': text.length,
      'Content-Type': 'text/plain' });
    response.end(text);
}

function sendHtmlResponse(response, text, statusCode) {
    statusCode = typeof statusCode !== 'undefined' ? statusCode : 200;

    response.writeHead(statusCode, {
      'Content-Length': text.length,
      'Content-Type': 'text/html' });
    response.end(text);
}

function findClientConfig(apiKey) {
    for (i = 0; i < clientsData.length; i++) {
        if (clientsData[i]["apiKey"] == apiKey)
            return clientsData[i];
    }
    return null;
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
}

function generateApiKey() {
    var uuid = generateUUID();
    var sha = crypto.createHash('sha512');
    sha.update(uuid, 'ascii');
    var apiKey = sha.digest('base64');
    return apiKey;
}
