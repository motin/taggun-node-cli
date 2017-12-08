var path = require("path");
var fs = require("fs");
var request = require("request");
var hashFiles = require('hash-files');

if (process.argv.length < 3) {
    console.error("Usage: node cli.js <taggunApiKey> <exiftool-output.csv>");
    process.exit(0);
    throw "Abort";
}

var taggunCachePath = path.join(__dirname, "taggun-cache");
var taggunApiKey = process.argv[2];

var csv = require("fast-csv");

var csvDataFilePath = process.argv[3];
console.log("csvDataFilePath", csvDataFilePath);
var sourceFilesDirectory = path.dirname(csvDataFilePath);
console.log("sourceFilesDirectory", sourceFilesDirectory);

/*
var receiptPath = process.argv[2];
console.log("receiptPath", receiptPath);
*/

async function requestTaggunMetadataJson(receiptPath) {

    var mime = require('mime');
    var filename = path.basename(receiptPath);
    var contentType = mime.lookup(receiptPath);

    const formData = {
        //ipAddress: '1.2.3.4',
        file: {
            value: fs.createReadStream(receiptPath),
            options: {
                filename: filename,
                contentType: contentType,
            }
        }
    };

    return new Promise(function (resolve, reject) {

        request.post({
            url: 'https://api.taggun.io/api/receipt/v1/verbose/file', formData,
            headers: {apikey: taggunApiKey}
        }, (err, httpResponse, body) => {
            if (err) {
                console.error('Upload failed');
                reject(err);
            }
            console.log('Upload successful!');
            resolve(body);
        });

    });

}

async function requestTaggunMetadataJsonIfNotAlreadyCached(receiptPath) {

    return new Promise(function (resolve, reject) {

        // check if already has taggun metadata
        var options = {
            files: [receiptPath],
            noGlob: true,
            algorithm: 'sha1',
        };
        hashFiles(options, async function (error, hash) {
            // hash will be a string if no error occurred

            console.log(`hash of ${receiptPath}`, hash);

            var taggunMetadataJsonPath = path.join(taggunCachePath, hash + '.json');

            if (!fs.existsSync(taggunMetadataJsonPath)) {

                var taggunMetadataJson = await requestTaggunMetadataJson(receiptPath);
                //console.log('taggunMetadataJson', taggunMetadataJson);

                console.log('Storing taggunMetadataJson json');
                fs.writeFile(taggunMetadataJsonPath, taggunMetadataJson, function (resultsWriteErr) {
                    if (resultsWriteErr) {
                        console.error(`Couldn't write data to ${taggunMetadataJsonPath}!`);
                        console.error(resultsWriteErr);
                        reject(resultsWriteErr);
                    }
                    resolve(taggunMetadataJson);
                });


            } else {
                console.log('Taggun metadata already cached');
                var taggunMetadataJson = fs.readFileSync(taggunMetadataJsonPath);
                resolve(taggunMetadataJson);
            }

        });

    });

}

async function loadCsv(csvDataFilePath) {

    var csvRows = [];

    return new Promise(function (resolve, reject) {

        csv
            .fromPath(csvDataFilePath, {
                headers: true,
            })
            .on("data", function (data) {
                //console.log('data', data);
                csvRows.push(data);
            })
            .on("end", function () {
                console.log("Done reading csv");
                resolve(csvRows);
            });

    });

}

async function getReconciliationMetadata(csvRows, sourceFilesDirectory) {

    var reconciliationMetadata = [];

    for (var i = 0, len = csvRows.length; i < len; i++) {
        var csvRow = csvRows[i];

        var relativePath = csvRow.SourceFile;
        //console.log('relativePath', relativePath, csvRow);
        var receiptPath = path.join(sourceFilesDirectory, relativePath);

        var taggunMetadataJson = await requestTaggunMetadataJsonIfNotAlreadyCached(receiptPath);
        var taggunMetadata = JSON.parse(taggunMetadataJson);

        reconciliationMetadata.push({
            relativePath: relativePath,
            totalAmount: taggunMetadata.totalAmount ? taggunMetadata.totalAmount.data : '',
            totalAmountText: taggunMetadata.totalAmount ? taggunMetadata.totalAmount.text : '',
            taxAmount: taggunMetadata.taxAmount ? taggunMetadata.taxAmount.data : '',
            taxAmountText: taggunMetadata.taxAmount ? taggunMetadata.taxAmount.text : '',
            date: taggunMetadata.date ? taggunMetadata.date.data : '',
            dateText: taggunMetadata.date ? taggunMetadata.date.text : '',
            merchantName: taggunMetadata.merchantName ? taggunMetadata.merchantName.data : '',
            merchantNameText: taggunMetadata.merchantName ? taggunMetadata.merchantName.text : '',
            merchantAddress: taggunMetadata.merchantAddress ? taggunMetadata.merchantAddress.data : '',
            merchantAddressText: taggunMetadata.merchantAddress ? taggunMetadata.merchantAddress.text : '',
            text: taggunMetadata.text ? taggunMetadata.text.text : '',
            //taggunMetadata: taggunMetadata,
            //csvRow: csvRow,
        });

    }

    return reconciliationMetadata;

}

(async () => {
    try {

        var csvRows = await loadCsv(csvDataFilePath);
        var reconciliationMetadata = await getReconciliationMetadata(csvRows, sourceFilesDirectory);

        console.log('Storing results.csv');
        csv
            .writeToPath("./results.csv", reconciliationMetadata, {
                quoteColumns: true,
                headers: [
                    'relativePath',
                    'totalAmount',
                    'totalAmountText',
                    'taxAmount',
                    'taxAmountText',
                    'date',
                    'dateText',
                    'merchantName',
                    'merchantNameText',
                    'merchantAddress',
                    'merchantAddressText',
                    'text',
                ]
            })
            .on("finish", function () {
                console.log("CSV export done!");
            });

        console.log('Storing results.json');
        fs.writeFile('./results.json', JSON.stringify(reconciliationMetadata, null, 2) + "\n", function (resultsWriteErr) {
            if (resultsWriteErr) {
                console.error("Couldn't write data to results.json!");
                console.error(resultsWriteErr);
            } else {
                console.log("JSON export done!");
            }
        });

    } catch (e) {
        console.log(e)
    }
})();

