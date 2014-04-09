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
var mongoose = require('mongoose');
var unzip = require('unzip');
var rimraf = require('rimraf');


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
        case '/dumps':
            showDumpsList(req, res);
            break;
        case '/report':
            showCrashReport(req, res);
            break;
        case '/meta':
            showDumpMeta(req, res);
            break;
        default:
            sendTextResponse(res, "You'r doing it wrong!", 404);
            break;
    }
});

// TODO Check async.waterfall

// Configs
var configFilePath = __dirname + '/config.json';
var configData;

var clientsFilePath;
var clientsDataArr; // TODO add 'id' to clientData

// Tools
var dumpSymsToolPath;
var symbolicationToolPath;

// Working paths
var workingFolderPath;
var symbolsFolderPath;
var clientLibTargetPath;
var clientLibTempPath;
var clientDumpTargetPath;
var clientDumpTempPath;

// Database
var CrashDump;

main();


String.prototype.startsWith = function(prefix) {
    return this.indexOf(prefix) == 0;
};
String.prototype.endsWith = function(suffix) {
    return this.indexOf(suffix, this.length - suffix.length) !== -1;
};
if (!String.prototype.format) {
    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) { 
            return typeof args[number] != 'undefined'
                ? args[number]
                : match
            ;
        });
    };
}

function logError(message, err) {
    if (err) {
        console.error(message, err);
    }
}

function makeFullPath(configPath) {
    if (configPath.startsWith("/"))
        return configPath;

    return __dirname + "/" + configPath;
}

function readClientsConfig(callback) {
    fs.readFile(clientsFilePath, 'utf8', function (err, data) {
        if (err) {
            console.log('Error reading clients config file: ' + err);
            callback(err);
            return;
        }
     
        clientsDataArr = JSON.parse(data);
        console.log("Clients config data: ");
        console.dir(clientsDataArr);

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

function parseClientMeta(metaStr) {
    if (!metaStr)
        return null;

    try {
        var parsed = JSON.parse(metaStr);

        if (parsed)
            return parsed;
    } catch(e) {
        console.warn("::parseClientMeta Couldn't parse str with JSON.parse");
    }

    var metaData = new Object();
    var metaLines = metaStr.split("\n");

    for (i = 0; i < metaLines.length; i++) {
        var line = metaLines[i];
        var separatorIdx = line.indexOf(":");
        if (separatorIdx == -1)
            continue;

        var key = line.substring(0, separatorIdx);
        var value = line.substring(separatorIdx+2, line.length);
        metaData[key] = value;
    }

    return metaData;
}

function printCrashDumpTable(callback) {
    CrashDump.find().exec(function (err, dumps) {
        if (err) {
            console.error(err);
            return callback && callback(err);
        }
        console.log("Found dumps: " + dumps);
        callback && callback(null);
    });
}

function cleanCrashDumpTable(callback) {
    CrashDump.remove(function(err) {
        if (err) {
            console.error("::cleanCrashDumpsTable Failed to clean table: " + err);
            return callback && callback(err);
        }
        console.log("::cleanCrashDumpsTable CrashDump table cleaned");
        callback && callback(null);
    });
}

function saveDumpFileToDb(dumpsPath, dumpFileName, clientId, callback) {
    var dumpFilePath = dumpsPath + "/" + dumpFileName;
    var stats = fs.statSync(dumpFilePath);

    var dumpEntry = new CrashDump();
    dumpEntry.uploadDate = stats.mtime;
    dumpEntry.dumpFileName = dumpFileName;
    dumpEntry.clientId = clientId;
    dumpEntry.appId = "#none";
    dumpEntry.appVersion = "#none";
    dumpEntry.meta = "#none";
    
    var metaFileName = dumpFileName + ".meta";
    var metaFilePath = dumpsPath + "/" + metaFileName;
    var metaObject = null;

    if (fs.existsSync(metaFilePath)) {
        console.log("::saveDumpFileToDb Dump file META: " + metaFileName);

        dumpEntry.metaFileName = metaFileName;

        metaObject = parseClientMeta(fs.readFileSync(metaFilePath, 'utf8'));
        // console.dir(metaObject);
    }

    if (metaObject) {
        dumpEntry.appId = metaObject["AppId"];
        dumpEntry.appVersion = metaObject["AppVersion"];
        delete metaObject["AppId"];
        delete metaObject["AppVersion"];
        delete metaObject["ApiKey"];                
        // console.log("::saveDumpFileToDb Entry META object: ");
        // console.dir(metaObject);
        dumpEntry.meta = util.inspect(metaObject);
    }

    dumpEntry.save(function (err) {
        if (err) {
            console.error("::saveDumpFileToDb Failed to save CrashDump entry, error: " + err);
            return callback && callback(err);
        }
        console.log("::saveDumpFileToDb CrashDump entry saved");
        callback && callback(null);
    });
}

function populateCrashDumpTable(callback) {
    var dirsPending = clientsDataArr.length;
    var filesPending = 0;

    clientsDataArr.forEach(function(clientData) {
        var clientId = clientData["description"];
        var dumpsPath = clientDumpTargetPath + "/" + clientId;

        if (!fs.existsSync(dumpsPath)) {
            if (!--dirsPending && !filesPending && callback) {
                callback(null);
            }
            return;
        }

        console.log("::addCrashDumpsToDb Searching dumps in: " + clientId);

        var dumpFiles = fs.readdirSync(dumpsPath);
        filesPending += dumpFiles.length;

        dumpFiles.forEach(function(dumpFileName) {
            if (dumpFileName.startsWith(".") || dumpFileName.endsWith(".meta")) {
                console.log("::addCrashDumpsToDb Skipping file: " + dumpFileName);

                if (!dirsPending && !--filesPending && callback) {
                    callback(null);
                }
                return;
            }

            console.log("::addCrashDumpsToDb Found dump file: " + dumpFileName);
            
            saveDumpFileToDb(dumpsPath, dumpFileName, clientId, function(err) {
                if (err) {
                    console.error("::populateCrashDumpTable Failed to save dump file, error: " + err);
                }

                if (!dirsPending && !--filesPending && callback) {
                    callback(null);
                }
            });
        });

        --dirsPending;
    });
}

function initDbModels() {
    var crashDumpSchema = mongoose.Schema({
        uploadDate: Date,
        dumpFileName: String,
        metaFileName: String,

        clientId: String,
        appId: String,
        appVersion: String,
        meta: String //mongoose.Schema.Types.Mixed
    });
    CrashDump = mongoose.model('CrashDump', crashDumpSchema);    
}

function setDbConnectionCallback(callback) {
    var db = mongoose.connection;
    db.on('error', function(err) {
        console.error('DB connection error: ' + err);
        callback(err);
    });
    db.once('open', function() {
        console.log("Successfully connected to DB");

        callback(null);
    });   
}

function main() {
    console.log("New API key: " + generateApiKey());

    initDbModels();

    setDbConnectionCallback(function (err) {
        if (err) return console.error("Init database error: " + err);

        // printCrashDumpTable(function(err) {});
        // cleanCrashDumpTable(function(err) {});
        // populateCrashDumpTable(function(err) {
        // });

        // Server would listen on port 80
        var httpServerPort = configData["http_server_port"];
        server.listen(httpServerPort);
        console.log("HTTP server started, port: " + httpServerPort);
    });

    readServerConfig(function(err) {
        if (err) {
            console.log('Error reading server config: ' + err);
            return;
        }

        mongoose.connect(configData["db_connection_url"]);
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
    console.log("::display_form begin");

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
 * Replaces Zip file with unzipped entry file
 */
function extractZippedFile(zipFilePath, callback) {
    var extractDirPath = zipFilePath + "_unzip";

    fs.mkdir(extractDirPath, function(err) {
        if (err) return callback && callback(err);

        var extract = unzip.Extract({ path: extractDirPath });
        extract.on('error', function(err) {
            console.error("::extractZippedFile Failed to extract ZIP file");

            rimraf(extractDirPath, function(err2) {
                if (err2) {
                    console.error("::extractZippedFile Failed to delete temp unzip folder: " + err2);
                }
                callback && callback(err);
            });
        });
        extract.on('close', function() {
            console.log("::extractZippedFile ZIP file extracted to temp: " + extractDirPath);

            fs.readdir(extractDirPath, function(err, files) {
                if (err) {
                    rimraf(extractDirPath, logError.bind('Rimraf error: '));
                    return callback && callback(err);
                }

                if (files.length != 1) {
                    rimraf(extractDirPath, logError.bind('Rimraf error: '));
                    return callback && callback("Expected 1 extracted file but found: " + files.length);
                }

                var extractedFilePath = extractDirPath + "/" + files[0];
                // Replace Zip file
                fs.rename(extractedFilePath, zipFilePath, function(err) {
                    rimraf(extractDirPath, logError.bind('Rimraf error: '));
                    callback && callback(err);
                });
            });
        });
        fs.createReadStream(zipFilePath).pipe(extract);
    });
}

/*
 * Zip file detection
 */
function checkIsZipFile(filePath, callback) {
    var fileStream = fs.createReadStream(filePath);

    fileStream.on('readable', function() {
        // 0x50 0x4B 0x03 0x04
        var magicBytes = fileStream.read(4);
        // console.log("::checkIsZipFile Magic: " + magicBytes.toString('hex'));

        var isZipFile = magicBytes && magicBytes.length == 4 && 
            magicBytes[0] == 0x50 && magicBytes[1] == 0x4B &&
            magicBytes[2] == 0x03 && magicBytes[3] == 0x04;
        callback && callback(null, isZipFile);
    });
    fileStream.on('error', function(err) {
        callback && callback(err, false);
    });
}

// TODO Add database
/*
 * Handle file upload
 */
function uploadClientLib(request, response) {
    // if (request.method.toLowerCase() == 'post')

    var form = createIncomingForm(clientLibTempPath);

    form.parse(request, function(err, fields, files) {
        console.log("Form[client lib] on Parse");

        var apiKey = fields['apiKey'];
        var appId = fields['appId'];
        var appVersion = fields['appVersion'];

        console.log("   API key: " + apiKey);
        console.log("   App id: " + appId);
        console.log("   App version: " + appVersion);

        var appConfig = findClientConfig(apiKey);
        
        if (!appConfig || appConfig.appId != appId) {
            sendTextResponse(response, "ApiKey or App id is incorrect!", 403);
            return;
        }
        if (!appConfig.libUpload) {
            sendTextResponse(response, "Lib upload is restricted!", 403);
            return;
        }

        var file = files['upload-file'];
        var metaData = getClientMeta(fields, appConfig, appVersion);

        var errorResponse = function(err) {
            console.error("::uploadClientLib Failed with error: " + err);
            sendTextResponse(response, "Operation: FAILED", 500);
        }

        checkIsZipFile(file.path, function(err, isZipFile) {
            if (err) return errorResponse(err);

            if (isZipFile) {
                console.log("::uploadClientLib Uploaded file is Zip, extract");
                
                if (file.name.endsWith(".zip"))
                    file.name = file.name.substring(0, file.name.length-4);

                extractZippedFile(file.path, function(err) {
                    if (err) return errorResponse(err);
                    console.log("::uploadClientLib Zip file extracted");

                    handleUploadedLib(file, metaData, function(err) {
                        if (err) return errorResponse(err);
                        sendTextResponse(response, "Operation: OK", 200);
                    });
                });
            } else {
                handleUploadedLib(file, metaData, function(err) {
                    if (err) return errorResponse(err);
                    sendTextResponse(response, "Operation: OK", 200);
                });
            }
        });
    });
}

function handleUploadedLib(file, metaData, callback) {
    var uploadTargetPath = clientLibTargetPath;

    var tmpFileName = getFileNameWithoutExt(file.path);
    var metaFilePath = uploadTargetPath + "/" + file.name + "." + tmpFileName + ".meta";

    console.log("::handleUploadedLib MetaData str: " + JSON.stringify(metaData));

    fs.writeFile(metaFilePath, JSON.stringify(metaData), function (err) {
        if (err) {
            console.error("::handleUploadedLib Saving client lib META error: " + err);
            return callback && callback(err);
        }

        console.log('::handleUploadedLib Client lib META saved');

        // TODO Run in parallel and wait for the operations to complete before 'processClientLib' call
        var newFilePath = uploadTargetPath + "/" + file.name + "." + tmpFileName;
        console.log("::handleUploadedLib File target path " + newFilePath);

        fs.rename(file.path, newFilePath, function(err2) {  
            if (err2) {
                console.error("::handleUploadedLib File rename error: " + err2);
                return callback && callback(err2);
            }

            processClientLib(newFilePath, metaFilePath);
            console.log("::handleUploadedLib Uploaded tmp file renamed");

            callback && callback(null);
        });
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

                        // TODO Use rename instead
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
        console.log("::uploadClientDump Form[client dump] on Parse");

        var apiKey = fields['apiKey'];
        var appId = fields['appId'];
        var appVersion = fields['appVersion'];

        console.log("   API key: " + apiKey);
        console.log("   App id: " + appId);
        console.log("   App version: " + appVersion);

        var appConfig = findClientConfig(apiKey);
        
        if (!appConfig || appConfig.appId != appId) {
            sendTextResponse(response, "ApiKey or App id is incorrect!", 403);
            return;
        }
        if (!appConfig.dumpUpload) {
            sendTextResponse(response, "Dump upload is restricted!", 403);
            return;
        }

        var errorResponse = function(err) {
            console.error("::uploadClientDump Failed with error: " + err);
            sendTextResponse(response, "Operation: FAILED", 500);
        }

        // Write META
        var file = files['upload-file'];
        var tmpFileName = getFileNameWithoutExt(file.path);

        var appSubdirPath = uploadTargetPath + "/" + appConfig.description;
        checkAndCreateDir(appSubdirPath);

        var dumpFileName = file.name + "." + tmpFileName;
        var metaFilePath = appSubdirPath + "/" + dumpFileName + ".meta";

        var metaData = getClientMeta(fields, appConfig, appVersion);

        fs.writeFile(metaFilePath, JSON.stringify(metaData), function (err2) {
            if (err2) return errorResponse(err2);

            console.log("::uploadClientDump Client dump META saved");

            // Write dump file
            var targetFilePath = appSubdirPath + "/" + dumpFileName;
            console.log("   File target path " + newFilePath);

            fs.rename(file.path, targetFilePath, function(err2) {  
                if (err2) return errorResponse(err2);

                console.log("::uploadClientDump Uploaded tmp file renamed");

                saveDumpFileToDb(appSubdirPath, dumpFileName, appConfig.description, function(err2) {
                    if (err2) return errorResponse(err2);

                    console.log("::uploadClientDump Client dump saved to DB");

                    // Render response
                    sendTextResponse(response, "Operation: OK", 200);
                });
            });
        });
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
            sendTextResponse(response, "Operation: FAILED", 500);
            return;
        }

        addDirToArchive(archive, symbolsFolderPath, function(err2) {
            if (err2) {
                console.error("::sendBackSymbolsAndCrashes Zipping symbols error: " + err2);
                sendTextResponse(response, "Operation: FAILED", 500);
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
        if (err) return callback && callback(err);

        function zipFile(fileRelPath, zipCallback) {
            // console.log("::addDirToArchive Zipping file: " + fileRelPath);

            var fileAbsPath = parentDirPath + "/" + fileRelPath;
            archive.append(fs.createReadStream(fileAbsPath), { name: fileRelPath });

            zipCallback && zipCallback(null);
        }

        async.eachSeries(files, zipFile, function(err2) {
            if (err2) return callback && callback(err2);
            callback && callback(null);
        });
    });
}

/*
 * Show crash dumps list
 */
function showDumpsList(request, response) {
    console.log("::showDumpsList begin");

    CrashDump.find().select('_id uploadDate appId appVersion')
    .exec(function (err, dumpsArr) {
        if (err) {
            sendTextResponse(response, "Operation: FAILED", 500);
            return console.error(err);
        }
        // console.log("Found dumps: " + dumpsArr);

        var body = '<h1>Crash dumps:</h1>';
        
        for (i = 0; i < dumpsArr.length; i++) {
            var dumpEntry = dumpsArr[i];

            var reportLink = '<a href="/report?id={0}">{1}</a>'
                .format(dumpEntry._id, dumpEntry.uploadDate.toISOString());

            var metaLink = '<a href="/meta?id={0}">META</a>'.format(dumpEntry._id);

            body += '<div style="margin-top: 5px;">'
            body += reportLink;
            body += '<div style="margin-left: 10px; display: inline;"></div>';
            body += metaLink;
            body += '<div style="margin-left: 10px; display: inline;">App Id: {0} | App version: {1}</div>'
                .format(dumpEntry.appId, dumpEntry.appVersion);
            body += '</div>';
        }

        // console.log("::showDumpsList Result body: " + body);
        sendHtmlResponse(response, body, 200);
    });
}

/*
 * Show crash report
 */
function showCrashReport(request, response) {
    console.log("::showCrashReport begin");

    var query = url.parse(request.url, true).query;
    var dumpId = query["id"];
    console.log("::showCrashReport Dump id: " + dumpId);

    CrashDump.findOne({ "_id": dumpId}).select('clientId dumpFileName')
        .exec(function (err, dumpEntry) 
    {
        if (err) {
            sendTextResponse(response, "Operation: FAILED", 500);
            return console.error(err);
        }
        // console.log("::showCrashReport Found dump: " + dumpEntry);

        var dumpFilePath = clientDumpTargetPath + "/" + dumpEntry.clientId +"/" + dumpEntry.dumpFileName;
        console.log("::showCrashReport Dump file path: " + dumpFilePath);

        var command = symbolicationToolPath + " " + dumpFilePath + " " + symbolsFolderPath;

        var child1 = exec(command, function(err, stdout, stderr) {
            console.log("::showCrashReport crash report exec finished");

            if (err) {
                console.error("::showCrashReport symbolication exec error: " + err);
                console.error("::showCrashReport symbolication exec stderr: " + stderr);
                sendTextResponse(response, "Operation: FAILED", 500);
                return;
            }

            sendTextResponse(response, stdout, 200);
        });
    });
}

/*
 *
 */
function showDumpMeta(request, response) {
    console.log("::showDumpMeta begin");

    var query = url.parse(request.url, true).query;
    var dumpId = query["id"];
    console.log("::showDumpMeta Dump id: " + dumpId);

    CrashDump.findOne({ "_id": dumpId}).select('meta')
        .exec(function (err, dumpEntry) 
    {
        if (err) {
            sendTextResponse(response, "Operation: FAILED", 500);
            return console.error(err);
        }
        // console.log("::showDumpMeta Found dump: " + dumpEntry);

        // var metaFilePath = clientDumpTargetPath + "/" + dumpEntry.clientId +"/" + dumpEntry.metaFileName;
        // console.log("::showDumpMeta Dump meta file path: " + metaFilePath);

        sendTextResponse(response, dumpEntry.meta, 200);
    });
}

function listFilesRecursively(dirPath, subdirPath, doneCallback) {
    var files = [];

    fs.readdir(dirPath, function(err, entryArr) {
        if (err) return doneCallback && doneCallback(err, files); 

        var pending = entryArr.length;
        if (!pending) 
            return doneCallback && doneCallback(null, files);

        entryArr.forEach(function(entryName) {
            var entryPath = dirPath + '/' + entryName;

            fs.stat(entryPath, function(err, stat) {
                if (err) return doneCallback && doneCallback(err, files);

                if (stat && stat.isDirectory()) {
                    listFilesRecursively(entryPath, subdirPath + entryName + "/", function(err, res) {
                        files = files.concat(res);
                        if (err) doneCallback && doneCallback(err, files);
                        if (!--pending) doneCallback && doneCallback(null, files);
                    });
                } else if (stat && stat.isFile()) {
                    files.push(subdirPath + entryName);
                    if (!--pending) doneCallback && doneCallback(null, files);
                } else {
                    --pending;
                }
            });
        });
    });
}

function getClientMeta(fields, appConfig, appVersion) {
    var meta = new Object();
    meta["ApiKey"] = appConfig.apiKey;
    meta["AppId"] = appConfig.appId;
    meta["AppVersion"] = appVersion;

    var date = new Date();
    meta["CreateDateTime"] = date.toISOString();

    meta["ID"] = fields['meta.ID'];
    meta["MANUFACTURER"] = fields['meta.MANUFACTURER'];
    meta["MODEL"] = fields['meta.MODEL'];
    meta["PRODUCT"] = fields['meta.PRODUCT'];
    meta["VERSION.CODENAME"] = fields['meta.VERSION.CODENAME'];
    meta["VERSION.INCREMENTAL"] = fields['meta.VERSION.INCREMENTAL'];
    meta["VERSION.RELEASE"] = fields['meta.VERSION.RELEASE'];
    meta["VERSION.SDK_INT"] = fields['meta.VERSION.SDK_INT'];
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
    for (i = 0; i < clientsDataArr.length; i++) {
        if (clientsDataArr[i]["apiKey"] == apiKey)
            return clientsDataArr[i];
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
