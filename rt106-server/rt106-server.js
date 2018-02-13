// Copyright (c) General Electric Company, 2017.  All rights reserved.

const express      = require('express');
const cookieParser = require('cookie-parser'); // used to give each web client its own unique ID.
const fs           = require('fs'); // file system operations, used for "local" DICOM store (for testing).
const os           = require('os'); // Used to get the hostname.
const rp           = require('request-promise');
const uuid         = require('uuid');
const request      = require('request');
const csv          = require('csvtojson');
//const cors         = require('cors');

const winston      = require('winston');

// Rt 106 modules
const clientMgr    = require('./clientMgr');  // module for managing Rt106 web clients.
const MySQLmgr     = require('./MySQLmgr');   // module for managing MySQL interactions.
const healthMgr    = require('./healthMgr');  // module for checking the health of other required services.

var AMQPmgr      = null; // optional module for managing RabbitMQ queues.
var SQSmgr       = null; // optional module for managing SQS queues

/*
 * Dynamically create the config.js file.
 * If the environment variable Rt106_SERVER_HOST is defined, that is used in config.js.  Otherwise localhost is used.
 * If the environment variable Rt106_APP_DIR is defined, that is the location where config.js needs to be.  Otherwise use rt106-app.
 */
var gulp = require('gulp');
var ngConstant = require('gulp-ng-constant');
var Rt106_SERVER_URL = 'http://localhost'; // Default value, may be changed below.
if (process.env.Rt106_SERVER_HOST !== undefined) {
    Rt106_SERVER_URL = 'http://' + process.env.Rt106_SERVER_HOST;
}
console.log("gulp setting Rt106_SERVER_URL to " + Rt106_SERVER_URL);
var Rt106_APP_DIR = 'rt106-app';
if (process.env.Rt106_SERVE_APP !== undefined) {
    Rt106_APP_DIR = process.env.Rt106_SERVE_APP;
}
gulp.task('default', function() {
    gulp.src(Rt106_APP_DIR + '/config.json')
        .pipe(ngConstant({
            name: 'rt106.config',
            constants:
                {
                    Rt106_SERVER_URL: Rt106_SERVER_URL
                }
        }))
        .pipe(gulp.dest(Rt106_APP_DIR));
});
gulp.start('default');
/*
 * End of dynamic creation of config.js.
 */

// Constants
const PORT = 8106;
//const filepath = '/tests/demo_data/';    // for "local" (testing) DICOM store.

// Set up the "rt106server") (the server).
const rt106server = express();

rt106server.use(cookieParser());

// disabling cookie client tracking.  Use the same client info for everyone.
const defaultRt106Client = '9a76b01b9c359215f3f48cddbba8f145';
const useDefaultRt106Client = true;

// Keep a global variable of algorithm metadata, to avoid frequent requerying and asynchronous complexities in the GUI.
// TODO:  Refresh the variable occassionally.
var algoStruct = null;

MySQLmgr.initMySQL();
MySQLmgr.clearAnalytics() // Start with an empty list of analytics.  TODO:  How to handle this with multiple rt106-servers?
    .catch(function(err) {
        winston.error('Error clearing analytics');
    });

// REST endpoints for testing error propagation.
rt106server.get('/v1/fail/mysql', function(req, res) {
    winston.info("calling MySQLmgr.deliberateError()");
    MySQLmgr.deliberateError(function(error, results) {
        winston.info("In the callback for MySQLmgr.deliberateError()");
    })
        .then(function(result) {
            winston.info("MySQLmgr.deliberateError():  In the .then clause with " + JSON.stringify(result));
            res.status(200).send(result);
        })
        .catch(function(err) {
            winston.info("MySQLmgr.deliberateError():  In the .catch clause with " + err);
            res.status(501).send(err);
        });
});

rt106server.get('/v1/succeed/mysql', function(req, res) {
    winston.info("calling MySQLmgr.shouldSucceed()");
    MySQLmgr.shouldSucceed(function(error, results) {
        winston.info("In the callback for MySQLmgr.shouldSucceed()");
    })
        .then(function(result) {
            winston.info("MySQLmgr.shouldSucceed():  In the .then clause with... " + result );
            res.status(200).send(result);
        })
        .catch(function(err) {
            winston.info("MySQLmgr.shouldSucceed():  In the .catch clause with " + err);
            res.status(501).send(err);
        });
});




var msgSystem = 'amqp';
if (process.env.MSG_SYSTEM) {
  if (process.env.MSG_SYSTEM === 'amqp') {
    msgSystem = 'amqp';
  }
  if (process.env.MSG_SYSTEM === 'sqs') {
    msgSystem = 'sqs';
  }
}

var algoResponseQueue = 'rt106-algorithm-response--v1_0_0';
if (process.env.Rt106_ALGORITHM_RESPONSEQUEUE) {
  algoResponseQueue = process.env.Rt106_ALGORITHM_RESPONSEQUEUE;
}

var datastoreURI = 'http://datastore:5106/v1';
if (process.env.DATASTORE_URI) {
  datastoreURI = process.env.DATASTORE_URI;
}

// Setup the messaging system
if (msgSystem == 'amqp') {
  AMQPmgr = require('./AMQPmgr');
  AMQPmgr.initAMQP(algoResponseQueue, function(msg) {
    var parsedMsg = JSON.parse(msg);
    var executionId = parsedMsg.header.executionId;
    winston.info("[AMQP] response received, executionId="+executionId);
    winston.info("[AMQP] response received, msg is " + JSON.stringify(parsedMsg));
    MySQLmgr.queryClientName(executionId, function(error, results, fields) {
      winston.debug("execution results " + JSON.stringify(results));
      if (error) {
        winston.error("Error is " + JSON.stringify(error));
      }
      if (results.length !== 0) {
        var clientname = results[0].user;
        clientMgr.addResponseToList(clientname, JSON.parse(msg));

        clientMgr.lastTouched[clientname] = Date.now();
        MySQLmgr.touchClient(clientname)
            .catch(function(err) {
                winston.error('Error in touchClient: ' + err);
            });

          clientMgr.responsesExpected[clientname]--;
        MySQLmgr.decrementResponsesExpected(clientname)
            .catch(function(err) {
                winston.error('Error decrementing responses expected: ' + err);
            });

        MySQLmgr.insertResponseMessage(msg, clientname)
            .catch(function(err) {
                winston.error('Error logging response message to database: ' + err);
            });

      } else {
        winston.error("Could not locate client for execution " + executionId);
      }
    })
        .catch(function(err) {
            winston.error('Error getting client name while setting up AMQP: ' + err);
        })
  });
}

if (msgSystem == 'sqs') {
  SQSmgr = require('./SQSmgr');
  SQSmgr.initSQS(algoResponseQueue, function(msg) {
    var executionId = JSON.parse(msg).header.executionId;
    winston.info("[SQS] response received, executionId="+executionId);
    MySQLmgr.queryClientName(executionId, function(error, results, fields) {
      winston.debug("execution results " + JSON.stringify(results));
      if (error) {
        winston.error("Error is " + JSON.stringify(error));
      }
      if (results) {
        var clientname = results[0].user;
        clientMgr.addResponseToList(clientname, JSON.parse(msg));

        clientMgr.lastTouched[clientname] = Date.now();
        MySQLmgr.touchClient(clientname)
            .catch(function(err) {
                winston.error('Error in touchClient: ' + err);
            });

          clientMgr.responsesExpected[clientname]--;
        MySQLmgr.decrementResponsesExpected(clientname)
            .catch(function(err) {
                winston.error('Error decrementing responses expected: ' + err);
            });

        MySQLmgr.insertResponseMessage(msg, clientname)
            .catch(function(err) {
                winston.error('Error logging response message to database: ' + err);
            });
      }
    })
        .catch(function(err) {
            winston.error('Error getting client name while setting up SQS: ' + err);
        })
  });
}

// default route/interceptor for handling of CORS
rt106server.use(function(req, res, next) {
    //winston.debug('Default route/interceptor for handling CORS');
    //winston.debug('rt106server.use with ' + req.originalUrl + '. Headers in default use: ' + JSON.stringify(req.headers));
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Authorization,Accept,Content-Type,X-Requested-With");

  next();
});


// static content routes if serving a demo app or a user supplied app
if (process.env.Rt106_SERVE_APP) {
  winston.info("Rt106_SERVE_APP is set to: " + process.env.Rt106_SERVE_APP);
  if (process.env.Rt106_SERVE_APP === 'public') {
    winston.info("Running Rt 106 with a local demonstration application.");
    rt106server.use('/', express.static('public') );
    rt106server.use('/bower_components/rt106-frontend/rt106-app/', express.static('rt106-app'));  // mimic the URI paths of real app that was "bower install --save rt106-frontend"
  } else {
    winston.info("Running Rt 106 with a user specified application from " + process.env.Rt106_SERVE_APP);
    rt106server.use('/', express.static(process.env.Rt106_SERVE_APP) );
  }
} else {
  winston.info("Rt106_SERVE_APP is not set.");
}


rt106server.post('/v1/analytics/evaluation', function(req, res) {
    winston.info("Received analytics evaluation from IP: " + req.connection.remoteAddress +  "!");
    // Get the JSON from the message body.
    winston.info("Waiting for message body");
    var msgStr = '';
    req.on("data", function (chunk) {
        msgStr += chunk.toString();
        winston.debug("Message body so far: " + msgStr);
    });
    req.on("error", function(err) {
        winston.info("Error receiving message. " + err);
        res.status(500).json("Error receiving message in /v1/analytics/evaluation: " + err);
        return next(err);
    });
    req.on("end", function() {
        winston.info("Received message " + msgStr);
        var msgObj = JSON.parse(msgStr);
        MySQLmgr.insertAnalyticEvaluation(msgObj)
            .then(function(result) {
                res.status(200);
            })
            .catch(function(err) {
                winston.error('error inserting analytic evaluation: ' + err);
                res.status(500).send('Error inserting analytic evaluation');
            });
    });
});


/*
 * REST calls to request algorithm execution.
 */
 rt106server.post('/v1/execution', function(req, res) {
   winston.info("Received algorithm request from IP: " + req.connection.remoteAddress +  "!");
   // See if there are already cookies with client data.  If not, set up the new client.
   var clientName;

   // use a single client to track executions or use cookies (or use authentication)?
   if (useDefaultRt106Client === true) {
     // use a single client id to track executions
     clientName = defaultRt106Client;
     if (!clientMgr.clientInitialized(clientName)) {
       clientMgr.initializeClient(clientName);
     }
   } else {
     // use cookies to identify clients
     if (clientMgr.cookieExists(req, "rt106ClientName")) {
       clientName = req.cookies.rt106ClientName;

       // Make sure client has been initialized.
       if (!clientMgr.clientInitialized(clientName)) {
         clientMgr.initializeClient(clientName);
       }
     } else { // Client name cookie does not exist.
       clientName = clientMgr.getUniqueClientName(req);

       // Set the cookies.
       res.cookie('rt106ClientName', clientName);
       clientMgr.initializeClient(clientName);
     }
   }

   // Get the JSON from the message body.
   winston.info("Waiting for message body");
   var msgStr = '';
   req.on("data", function (chunk) {
     msgStr += chunk.toString();
     winston.info("Message body so far: " + msgStr);
   });
   req.on("error", function(err) {
    winston.info("Error receiving message. " + err);
    res.status(500).json("Error receiving message in /v1/execution: " + err);
    return next(err);
   });
   req.on("end", function() {
     winston.debug("Received message " + msgStr);
     var msgObj = JSON.parse(msgStr);
     var analyticName = msgObj.analyticId.name;
     // Set the UUID's.
     msgObj.header = {};
     msgObj.header.messageId = uuid.v4();
     msgObj.header.pipelineId = uuid.v4();
     msgObj.header.executionId = uuid.v4();
     msgObj.header.creationTime = Date.now();
     clientMgr.addRequestToList( clientName, msgObj );

     clientMgr.lastTouched[clientName] = Date.now();
     MySQLmgr.touchClient(clientName)
           .catch(function(err) {
               winston.error('Error in touchClient: ' + err);
           });


       clientMgr.responsesExpected[clientName]++;
     MySQLmgr.incrementResponsesExpected(clientName)
         .catch(function(err) {
             winston.error('Error incrementing responses expected: ' + err);
         });

     // Create the queue for algorithm requests if it does not already exist.
     // Get the request queue name for this algorithm, and don't proceed if there is any problem with this.
     var localURI = 'http://' + os.hostname() + ':' + PORT + '/v1/analytics/' + analyticName + '/queue';  // os.hostname() returns strings like 1a0412d09298 on Docker for Mac
     winston.debug('localURI is ' + localURI);
     rp({uri: localURI, json:true}).then(function(queueRes) {
       winston.debug('Queue for ' + analyticName + ' is ' + queueRes.queue);
       winston.debug("Client name is " + clientName);

       if (queueRes.queue === undefined) {
         winston.error('Queue for ' + analyticName + ' is not defined.');
         res.status(500).json('Queue for ' + analyticName + ' is not defined.');
         return;
       }

       if (msgSystem == 'sqs') {
         SQSmgr.initPromise.then(function() {
           var responseQueue = SQSmgr.responseQueue;
           winston.debug("Response queue is " + responseQueue);
           // Add the response queue to the message.
           msgObj.responseQueue = responseQueue;

           var msgBody = JSON.stringify(msgObj);
           var msgAttributes = {
             ReplyTo: { DataType: "String", StringValue: responseQueue }
           };
           winston.debug("/v1/execution: msgAttributes: " +
           JSON.stringify(msgAttributes));
           winston.debug("/v1/execution: msgBody: " + msgBody);

           SQSmgr.sqsResource.sendMessage(
             { MessageAttributes: msgAttributes,
               MessageBody: msgBody, QueueUrl: queueRes.queue },
               function(err,data) {
                 err && winston.error("[SQS] sendMessage - ", err.message);
             });
           // Write request message to MySQL.
           MySQLmgr.insertRequestMessage(msgObj, msgAttributes)
               .catch(function(err) {
                   // Error in MySQLmgr.insertRequestMessage()
                   winston.error('Error returned while logging sent request in database: ' + err);
                   res.status(500).send('Error returned while logging sent request in database');
               })
         }).catch(function(err) {
           winston.error('/v1/execution, SQSmgr.initPromise failed: ' + err);
         });
       }

       if (msgSystem == 'amqp') {
         AMQPmgr.initPromise.then(function() {
           var responseQueue = AMQPmgr.responseQueue;
           winston.debug("Response queue is " + responseQueue);
           var msgBody = JSON.stringify(msgObj);
           var rabbitHeader = {
             deliveryMode: AMQPmgr.AMQP_REQ_DELIVERY_MODE,
             headers: { messageId: msgObj.header.messageId,
               pipelineID: msgObj.header.pipelineID,
               executionId: msgObj.header.executionId,
               creationTime: msgObj.header.creationTime },
               contentType: 'application/json',
               replyTo: responseQueue,
               correlationId: msgObj.header.executionId,
               appId: clientName
           };

         if (AMQPmgr.reqChan.sendToQueue(queueRes.queue, new Buffer(msgBody), rabbitHeader)) {
           winston.debug(" [AMQP] Sent " + msgBody + " with header " +
           JSON.stringify(rabbitHeader));
           // Write request message to MySQL.
           MySQLmgr.insertRequestMessage(msgObj, rabbitHeader)
               .catch(function(err) {
                   // Error in MySQLmgr.insertRequestMessage()
                   winston.error('Error returned while logging sent request in database: ' + err);
                   res.status(500).send('Error returned while logging sent request in database');
               })
         } else {
           winston.error("[AMQP] error in sendToQueue");
           res.status(503).json("Error in sendToQueue");
           return;
         }
       }).catch(function(err) {
         winston.error('/v1/execution, AMQPmgr.initPromise failed: ' + err);
       });
     }
     })
     .catch(function(err) {
       winston.error('/v1/execution, ' + localURI + ' request failed: ' + err);
       res.status(500).json("Error getting queue in /v1/execution: " + err);
     });
   });
   res.status(200).json('HTTP server received algorithm request.'); // TODO:  That message is not part of HC protocol.
});

/*
 * Set up the client ID cookies for a newly-connected client.
 */
 rt106server.get('/v1/setCookies', function(req, res) {
   var cName = clientMgr.getUniqueClientName(req);
   // Set the cookies.
   res.cookie('rt106ClientName', cName);
   winston.debug('/v1/setCookies - rt106ClientName='+cName);
   res.json(cName);
 })

/*
 * Return the execution list for a given client.  The client's identify should have been sent as a cookie.
 */
 rt106server.get('/v1/executions', function(req, res) {
   // use a single client to track executions or use cookies (or use authentication)?
   if (useDefaultRt106Client === true) {
     // use a single client to track executions
     getExecutionsFromDB(defaultRt106Client);
     winston.debug("/v1/executions, returning (A) " + JSON.stringify(clientMgr.executionList));
     winston.debug("/v1/executions, clientMgr.executionList[defaultRt106Client] is " + JSON.stringify(clientMgr.executionList[defaultRt106Client]));
     res.json((clientMgr.executionList[defaultRt106Client] === undefined ? [] : clientMgr.executionList[defaultRt106Client]));
   } else {
     // use cookies to identify clients
     if (!clientMgr.cookieExists(req, 'rt106ClientName')) {
       // Return an empty list.
       winston.info('/v1/executions - cookie does not exist');
       res.json({});
     } else {
       // return the execution list.
       if (typeof clientMgr.executionList[req.cookies.rt106ClientName] == 'undefined') {
         winston.debug('/v1/executions - is empty');
         res.json([]);
       } else {
         //res.json(clientMgr.executionList[req.cookies.rt106ClientName]);
         getExecutionsFromDB(req.cookies.rt106ClientName);
         winston.debug("/v1/executions, returning (B) " + JSON.stringify(clientMgr.executionList[req.cookies.rt106ClientName]));
         res.json((clientMgr.executionList[req.cookies.rt106ClientName] === undefined ? [] : clientMgr.executionList[req.cookies.rt106ClientName]));
       }
     }
   }
 });

 function getExecutionsFromDB(clientName) {
     MySQLmgr.queryExecutionList(clientName, function(error, results) {
         winston.debug("getExecutionsFromDB(" + clientName + "), the execution list from the DB is " + JSON.stringify(results));
         clientMgr.executionList[clientName] = [];
         if (error) {
             winston.error("Error is " + JSON.stringify(error));
         }
         if (results) {
             for (var i = 0; i < results.length; i++) {
                 var restored_json = JSON.parse(results[i].message_json);
                 //winston.debug("On startup, one execution list from DB is: " + JSON.stringify(restored_json));
                 clientMgr.executionList[clientName].push(restored_json);
             }
             winston.debug("getExecutionsFromDB(" + clientName + "), set clientMgr.executionList to " + JSON.stringify(clientMgr.executionList));
         }
     }).
         catch(function(err) {
             winston.error('Error querying the execution list: ' + err);
     })
 }

/*
 * Tell the server to pull its existing execution list from the database.
 */
 rt106server.get('/v1/queryExecutionList', function(req, res) {
   // use a single client to track executions or use cookies (or use authentication)?
   var clientName;
   if (useDefaultRt106Client === true) {
     // use a single client to track executions
     clientName = defaultRt106Client;
   } else {
     // use cookies to identify clients
     if (clientMgr.cookieExists(req, "rt106ClientName")) {
       clientName    = req.cookies.rt106ClientName;
     } else { // Client name cookie does not exist.
       clientName = clientMgr.getUniqueClientName(req);
       // Set the cookies.
       res.cookie('rt106ClientName',    clientName);
     }
   }

   // return the execution list.
   winston.debug('/queryExceutionList - rt106ClientName='+clientName);
   clientMgr.initializeExecutionList(clientName);
   res.json("Requested query of execution list");
 });


/*
 * The following functions have been used for testing.  They are typically used from Postman to query the state
 * of the server.
 */

rt106server.get('/v1/clients', function(req, res) {
    res.json(clientMgr.clientList);
})

// This REST endpoint is only for testing.
rt106server.get('/v1/clientInfo/:client', function(req, res) {
  // Just return a big string.
  var cName = req.params.client;
  var retStr = "Client " + cName + "\n" +
    "responseQueue is " + clientMgr.responseQueue[cName] + "\n" +
    "lastTouched is " + clientMgr.lastTouched[cName] + "\n" +
    "responsesExpected is " + clientMgr.responsesExpected[cName] + "\n" +
    "executionList is " + JSON.stringify(clientMgr.executionList[cName]);
  res.json(retStr);
});

rt106server.get('/v1/executionList/:client', function(req, res) {
  winston.info("/v1/executionList client= " + req.params.client);
  res.json(clientMgr.executionList[req.params.client]);
});

// Add a REST call to forward access to the datastore. Note the handling/forwarding of Authorization
rt106server.use('/v1/datastore/*', function (req, res) {
  winston.debug('/v1/datastore/* ' + req.method + ' ' + JSON.stringify(req.headers));

  // Need to respond to OPTIONS here.  Not sure why the default route/intereceptor for CORS is not used.
  if (req.method === 'OPTIONS') {
    winston.debug('Responding to OPTIONS in /datastore');
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Authorization,Accept,Content-Type,X-Requested-With");
    res.end();
  }

  if (req.method === 'GET' || req.method === 'POST') {
    var url = req.baseUrl.replace(/^\/v1\/datastore/, datastoreURI);
    winston.debug('BaseURL: ' + req.baseUrl + ', Rerouting to: ' + url);

    var forward = {
      url: url,
      method: req.method
    }
    if ('authorization' in req.headers) {  // Note: node.js lowercases all header keys for easy comparison
      forward.headers = {};
      forward.headers['authorization'] = req.headers['authorization'];
    }
    winston.debug('Forwarding req: ' + JSON.stringify(forward));
    request(forward).pipe(res);
  }
});

rt106server.get('/v1/dataconvert/csvtojson/v1/pathology/datafile/Slides/:slide/:region/:pipelineid/:execid', function(req, res) {
  winston.debug('OriginalURL: ' + req.originalUrl);
  // Get the path to the csv data file.
  var csvpathsURI = datastoreURI + '/pathology/slides/' + req.params.slide + '/regions/' + req.params.region + '/results/' + req.params.pipelineid +
      '/steps/' + req.params.execid + '/instances'
  winston.debug('csvpathsURI: ' + csvpathsURI);
  rp({uri: csvpathsURI, headers: {}})
      .then(function(instances) {
          winston.debug("Returned instances: " + JSON.stringify(instances));
          csvpath = JSON.parse(instances)[0]
          winston.debug("csvpath is " + csvpath);
          // Get the csv data from the csvpath.
          var csvdataURI = datastoreURI + '/instance' + csvpath + '/csv';
          rp({uri: csvdataURI, headers: {}})
              .then(function(csvData) {
                    // Convert the csv data to JSON.
                    winston.debug("Received CSV data: " + csvData);
                    var jsonData = {};
                    jsonData.cells = [];
                    csv()
                        .fromString(csvData)
                        .on('json', (jsonObj) => {
                            winston.debug("jsonObj is " + JSON.stringify(jsonObj));
                            jsonData.cells.push(jsonObj);
                        })
                        .on('done',(error)=> {
                            winston.debug('end parsing CSV');
                            winston.debug("jsonData is " + JSON.stringify(jsonData));
                            res.status(200).json(jsonData);
                        })
              })
              .catch(function (err) {
                    winston.error(err);
                    res.status(500).json("Error in call to /v1/dataconvert: " + err);
              });
      })
});

// Health checks.  Return list of bad services.
rt106server.get('/v1/health/bad', function(req, res) {
  MySQLmgr.queryBadServices()
      .then(function(result) {
          res.status(200).json(result);
      })
      .catch(function(err) {
          winston.error('Error in MySQLmgr.queryBadServices: ' + err);
          res.status(500);
      });
});


// Add a REST call to get the list of available analytics
rt106server.get('/v1/analytics', function(req, res) {
  // query consul for the list of services
//  winston.debug('Querying catalog of analytics');
  rp({uri: 'http://consul:8500/v1/catalog/services', headers: {}, json:true})
  .then(function (fullCatalog) {
    //console.log("Returned from consul:8500/v1/catalog/services: " + JSON.stringify(fullCatalog));
    var catalog = {};
//    winston.debug('creating service catalog');
    for (var service in fullCatalog) {
      if (fullCatalog[service].indexOf('analytic') !== -1) {
//        winston.debug('analytic ', {service: service});
        catalog[service] = fullCatalog[service];
      }
    }
    res.status(200).json(catalog);
  })
  .catch(function (err) {
    winston.error(err);
    res.status(500).json("Error in call to consul: " + err);
  });
});


// Add a REST call to get the health (ping) for an analytic
rt106server.get('/v1/analytics/:analytic', function(req, res) {
  // query consul for the information on all the instances on the requested service
  winston.debug('Health check on: ' + req.params.analytic);
  rp({uri: 'http://consul:8500/v1/catalog/service/' + req.params.analytic, headers: {}, json:true})
  .then(function (instances) {
    console.log("Returned from consul:8500/v1/catalog/service/" + req.params.analytic + ": " + JSON.stringify(instances));
    if (instances.length === 0) {
      res.status(404).json("Analytic '" + req.params.analytic + "' is not available.");
    } else {
      winston.debug('instances[0] is ' + JSON.stringify(instances[0]));
      // instances is a list of all the instances of that service (analytic)
      rp({uri: 'http://' + instances[0]['ServiceAddress'] + ':' + instances[0]['ServicePort'] + '/v1', json:true})
      .then(function (response) {
        res.json(response);
      })
      .catch(function (err) {
        winston.error(err);
        res.status(500).json("Error in REST call to analytic: " + err);
      })
    }
  })
  .catch(function (err) {
    winston.error(err);
    res.status(500).json("Error in call to consul: " + err);
  });
});

// Add a REST call to get the API to an analytic
rt106server.get('/v1/analytics/:analytic/api', function(req, res) {
  // query consul for the information on all the instances on the requested service
  winston.debug('Requesting api for: ' + req.params.analytic);
  rp({uri: 'http://consul:8500/v1/catalog/service/' + req.params.analytic, json:true})
    .then(function (instances) {
      if (instances.length === 0) {
        res.status(404).json("Analytic '" + req.params.analytic + "' is not available.");
      } else {
        // instances is a list of all the instances of that service (analytic)
        rp({uri: 'http://' + instances[0]['ServiceAddress'] + ':' + instances[0]['ServicePort'] + '/v1' + '/api', json:true})
          .then(function (api) {
            res.json(api);
          })
          .catch(function (err) {
            winston.error(err);
            res.status(500).json("Error in REST call to analytic: " + err);
          })
      }
    })
    .catch(function (err) {
      winston.error(err);
      res.status(500).json("Error in call to consul: " + err);
    });
});

// Add a REST call to get the queue for an analytic
rt106server.get('/v1/analytics/:analytic/queue', function(req, res) {
  winston.debug('Requesting queue for: ' + req.params.analytic);
  rp({uri: 'http://consul:8500/v1/catalog/service/' + req.params.analytic, json:true})
    .then(function (instances) {
      if (instances.length === 0) {
        res.status(404).json("Analytic '" + req.params.analytic + "' is not available.");
      } else {
        // instances is a list of all the instances of that service (analytic)
        rp({uri: 'http://' + instances[0]['ServiceAddress'] + ':' + instances[0]['ServicePort'] + '/v1' + '/queue', json:true})
        .then(function (analyticResponse) {
          if (msgSystem == 'sqs') {
            SQSmgr.getQueueUrl(analyticResponse.queue)
            .then(function(queueUrl) { res.json(JSON.stringify({ 'queue' : queueUrl })); })
            .catch(function(err) {
              winston.error("[SQS] getQueueUrl failed - ", err.message);
              res.status(500).json(err);
            });
          }
          else res.json(analyticResponse);
        })
        .catch(function (err) {
          winston.error(err);
          res.status(500).json("Error in REST call to analytic: " + err);
        })
      }
    })
    .catch(function (err) {
      winston.error(err);
      res.status(500).json("Error in call to consul: " + err);
    });
});

// Add a REST call to get the parameters for an analytic
rt106server.get('/v1/analytics/:analytic/parameters', function(req, res) {
  //winston.debug('Requesting parameters for: ' + req.params.analytic);
  rp({uri: 'http://consul:8500/v1/catalog/service/' + req.params.analytic, json:true})
  .then(function (instances) {
    if (instances.length === 0) {
      res.status(404).json("Analytic '" + req.params.analytic + "' is not available.");
    } else {
      // instances is a list of all the instances of that service (analytic)
      let uristring = 'http://' + instances[0]['ServiceAddress'] + ':' + instances[0]['ServicePort'] + '/v1' + '/parameters';
      //winston.debug('uristring is ' + uristring);
      //winston.debug('Requesting the parameters for ' + uristring);
      rp({uri: uristring, json:true})
      .then(function (parameters) {
        //winston.debug('Received parameters successfully: ' + JSON.stringify(parameters));
        res.json(parameters);
      })
      .catch(function (err) {
        winston.debug('Error in receiving parameters');
        winston.error(err);
        res.status(500).json("Error in REST call to analytic: " + err);
      })
    }
  })
  .catch(function (err) {
    winston.debug('Error in call to http://consul:8500/v1/catalog/service/' + req.params.analytic);
    winston.error(err);
    res.status(500).json("Error in call to consul: " + err);
  });
});

// Add a REST call to get the results structure for an analytic
rt106server.get('/v1/analytics/:analytic/results', function(req, res) {
  //winston.debug('Requesting results structure for: ' + req.params.analytic);
  //winston.debug('uristring=' + 'http://consul:8500/v1/catalog/service/' + req.params.analytic);
  rp({uri: 'http://consul:8500/v1/catalog/service/' + req.params.analytic, json:true})
  .then(function (instances) {
    if (instances.length === 0) {
      res.status(404).json("Analytic '" + req.params.analytic + "' is not available.");
    } else {
      // instances is a list of all the instances of that service (analytic)
      let uristring = 'http://' + instances[0]['ServiceAddress'] + ':' + instances[0]['ServicePort'] + '/v1' + '/results';
      //winston.debug('uristring is ' + uristring);
      rp({uri: uristring, json:true})
      .then(function (parameters) {
        // Commenting out the lines below which result in verbose console output in debug mode.
        //winston.debug('[RP]'+uristring);
        //winston.debug(parameters);
        res.json(parameters);
      })
      .catch(function (err) {
        winston.error(err);
        res.status(500).json("Error in REST call to analytic: " + err);
      })
    }
  })
  .catch(function (err) {
    winston.error(err);
    res.status(500).json("Error in call to consul: " + err);
  });
});

// Add a REST call to get the display structure for an analytic
rt106server.get('/v1/analytics/:analytic/results/display', function(req, res) {
  //winston.debug('Requesting display structure for: ' + req.params.analytic);
  rp({uri: 'http://consul:8500/v1/catalog/service/' + req.params.analytic, json:true})
  .then(function (instances) {
    if (instances.length === 0) {
      res.status(404).json("Analytic '" + req.params.analytic + "' is not available.");
    } else {
      // instances is a list of all the instances of that service (analytic)
      let uristring = 'http://' + instances[0]['ServiceAddress'] + ':' + instances[0]['ServicePort'] + '/v1' + '/results/display';
      //winston.debug('uristring is ' + uristring);
      rp({uri: uristring, json:true})
      .then(function (parameters) {
        res.json(parameters);
      })
      .catch(function (err) {
        winston.error(err);
        res.status(500).json("Error in REST call to analytic: " + err);
      })
    }
  })
  .catch(function (err) {
    winston.error(err);
    res.status(500).json("Error in call to consul: " + err);
  });
});

// Add a REST call to get the documentation for an analytic
rt106server.get('/v1/analytics/:analytic/documentation', function(req, res) {
  winston.debug('Requesting documentation for: ' + req.params.analytic);
  rp({uri: 'http://consul:8500/v1/catalog/service/' + req.params.analytic, json:true})
  .then(function (instances) {
    if (instances.length === 0) {
      res.status(404).json("Analytic '" + req.params.analytic + "' is not available.");
    } else {
      // instances is a list of all the instances of that service (analytic)
      rp({uri: 'http://' + instances[0]['ServiceAddress'] + ':' + instances[0]['ServicePort'] + '/v1' + '/documentation', json:true})
      .then(function (doc) {
        res.json(doc);
      })
      .catch(function (err) {
        winston.debug(err);
        res.status(500).json("Error in REST call to analytic: " + err);
      })
    }
  })
  .catch(function (err) {
    winston.error(err);
    res.status(500).json("Error in call to consul: " + err);
  });
});

// Add a REST call to get the classification for an analytic
rt106server.get('/v1/analytics/:analytic/classification', function(req, res) {
  winston.debug('Requesting classification for: ' + req.params.analytic);
  rp({uri: 'http://consul:8500/v1/catalog/service/' + req.params.analytic, json:true})
  .then(function (instances) {
    if (instances.length === 0) {
      res.status(404).json("Analytic '" + req.params.analytic + "' is not available.");
    } else {
      // instances is a list of all the instances of that service (analytic)
      rp({uri: 'http://' + instances[0]['ServiceAddress'] + ':' + instances[0]['ServicePort'] + '/v1' + '/classification', json:true})
      .then(function (classification) {
        res.json(classification);
      })
      .catch(function (err) {
        winston.debug(err);
        res.status(500).json("Error in REST call to analytic: " + err);
      })
    }
  })
  .catch(function (err) {
    winston.error(err);
    res.status(500).json("Error in call to consul: " + err);
  });
});

module.exports = { rt106server: rt106server, healthMgr: healthMgr};


//winston.level = 'debug';
winston.level = 'info';
 /*
  * Start listening!
  */
rt106server.listen(PORT);
 ('Running on http://' + os.hostname() + ':' + PORT);
