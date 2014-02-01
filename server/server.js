var http = require("http");
var url = require("url");
var sys = require("sys");
var events = require("events");
var util = require('util');
var crypto = require('crypto');
var path = require('path')
var formidable = require('formidable');
var fs   = require('fs');


var server = http.createServer(function(req, res) {
    // Simple path-based request dispatcher
    switch (url.parse(req.url).pathname) {
        case '/':
            display_form(req, res);
            break;
        case '/upload':
            upload_file(req, res);
            break;
        default:
            show_404(req, res);
            break;
    }
});

var configFilePath = __dirname + '/config.json';
console.log("Config file path: " + configFilePath);

var targetUploadPath    = __dirname + "/uploaded";
var tempUploadPath      = __dirname + "/tmp_upload";

var configData;

fs.readFile(configFilePath, 'utf8', function (err, data) {
    if (err) {
        console.log('Error reading config file: ' + err);
        return;
    }
 
    configData = JSON.parse(data);
    console.dir(configData);

    console.log("New API key: " + generateApiKey());

    // Server would listen on port 80
    server.listen(80);
});

/*
 * Display upload form
 */
function display_form(request, response) {
    var body = '<h1>Hello!</h1>'+
        '<form action="/upload" method="post" enctype="multipart/form-data">'+
        '<input type="text" name="apiKey" style="width: 750px;" value="Itp9g4219uvmPxXYUmR546VjbXrJGknhdh5GY72gUoGxujzHbczj31PNKsXE25rYCS0ukQyGyCOX9IbszYzq3A=="><br/>'+
        '<input type="text" name="appId" style="width: 250px;" value="com.redsteep.simpleapp"><br/>'+
        '<input type="text" name="appVersion" value="1.0 dev-1"><br/>'+
        '<input type="file" name="upload-file">'+
        '<input type="submit" value="Upload">'+
        '</form>';
    response.writeHead(200, {
      'Content-Length': body.length,
      'Content-Type': 'text/html' });
    response.end(body);
}

/*
 * Handle file upload
 */
function upload_file(request, response) {
    // if (request.method.toLowerCase() == 'post')

    var form = new formidable.IncomingForm();
    form.uploadDir = tempUploadPath;

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

    form.parse(request, function(err, fields, files) {
        console.log("Form on Parse");

        var file = files['upload-file'];

        var extname = path.extname(file.path);
        var filename = path.basename(file.path, extname);

        var newFilePath = targetUploadPath + "/" + file.name + "." + filename;

        console.log("   File target path " + newFilePath);

        var apiKey = fields['apiKey'];
        var appId = fields['appId'];
        var appVersion = fields['appVersion'];

        console.log("   API key: " + apiKey);
        console.log("   App id: " + appId);
        console.log("   App version: " + appVersion);

        var appConfig = findAppConfig(apiKey) //configData[apiKey];
        
        if (!appConfig || appConfig.appId != appId) {
            var body = "ApiKey or App id is incorrect!";
            response.writeHead(200, {
              'Content-Length': body.length,
              'Content-Type': 'text/plain' });
            response.end(body);
            return;
        }

        fs.rename(file.path, newFilePath, function(err2) {  
            if (err2) {
                console.error("File rename error: " + err2);
            } else {
                console.log("Uploaded tmp file renamed");
            }
        });

        // Render response
        var body = "Thanks for playing!\n";
        body += "received upload:\n\n";
        body += util.inspect({fields: fields, files: files});

        response.writeHead(200, {
          'Content-Length': body.length,
          'Content-Type': 'text/plain' });
        response.end(body);
    });
}

/*
 * Handles page not found error
 */
function show_404(request, response) {
    var body = "You'r doing it wrong!";
    response.writeHead(404, {
      'Content-Length': body.length,
      'Content-Type': 'text/plain' });
    response.end(body);
}

function findAppConfig(apiKey) {
    for (i = 0; i < configData.length; i++) {
        if (configData[i]["apiKey"] == apiKey)
            return configData[i];
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
