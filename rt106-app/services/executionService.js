// Copyright (c) General Electric Company, 2017.  All rights reserved.

// make this module work with RequireJS or as a browser global
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define(['angular', '../module'], factory);
  } else {
    // Browser globals
    root.executionService = factory(angular, angular.module('rt106'));
  }
}(this, function(angular, mod) {

  'use strict';
  mod.service('executionService', ['$http', '$log', 'alarmService', 'utilityFns', 'Rt106_SERVER_URL', function($http, $log, alarmService, utilityFns, Rt106_SERVER_URL) {


    /*
     * Poll the server for the execution list belonging to this web client.
     * Only report the first error with this function, rather than reporting every second (for example) if there is an error.
     */
    var pollErrorReported = false;
    this.pollExecList = function(execList, ngScope) {
      var promise = new Promise(function(resolve, reject) {
        $http.get(utilityFns.rt106_server_url() + '/v1/executions')
          .then(function(result) {
            // Weave the newly-queried execution list into execList, but don't just replace the entire thing,
            // because this confuses some AngularJS operations that watches for variables as having changed.
            // First, iterate through result.data.
            //    If an item is new, push it onto the front of execList (unshift).
            //    If an item's result field has changed, copy the new result.
            for (var i = 0; i < result.data.length; i++) {
              var execIdNew = result.data[i].executionId;
              var found = false;
              for (var j = 0; j < execList.length; j++) {
                var execIdOld = execList[j].executionId;
                if (execIdNew == execIdOld) {
                  // Found matching executionId's.
                  found = true;
                  // Have the results changed?
                  if (!utilityFns.isEquivalent(result.data[i].result, execList[j].result)) {
                    execList[j].result = result.data[i].result;
                    // Also copy status, resultSeries, and responseTime.
                    execList[j].status = result.data[i].status;
                    execList[j].resultSeries = result.data[i].resultSeries; // Is there still a resultSeries??
                    execList[j].responseTime = result.data[i].responseTime;
                    execList[j].details = result.data[i].details;
                  }
                  break;
                }
              }
              if (!found) {
                // New execution record.  Add it locally.
                execList.unshift(result.data[i]);
              }
            }
            utilityFns.updateScroll(ngScope);
            resolve();
          }, function(err) {
            // Only display an alert the first time.
            if (!pollErrorReported) {
              $log.error("pollExecList returned an error.", err.data);
              alarmService.displayAlert("Error polling execution list.");
              pollErrorReported = true;
            }
            reject("Error in polling " + err.data);
          });
      });
      return promise;
    };


    this.initExecution = function() {
      $http.get(utilityFns.rt106_server_url() + '/v1/setCookies')
        .then(function(result) {
          // Nothing to do here.  This is just telling the server to set up cookies.
        }, function(err) {
          $log.error("/v1/setCookies returnes an error.", err.data);
          alarmService.displayAlert("Error setting cookies");
        });
      $http.get(utilityFns.rt106_server_url() + '/v1/queryExecutionList')
        .then(function(result) {
          // Nothing to do here.  This is just telling the server to set up its execution list from the database.
        }, function(err) {
          $log.error("/v1/queryExecutionList returned an error.", err.data);
          alarmService.displayAlert("Error initializing execution list");
        });
    }

    /*
     * Request an algorithm run from the GUI.
     */

    this.autofillRadiologyParameters = function(selectedParameters, selectedSeries) {
      return new Promise(function(resolve, reject) {
        // Perform any special handling and autofill required for parameters.
        var promiseArray = [];
        for (var paramName in selectedParameters) {
            // Any parameter that waits for a promise to be resolved should create a promise here and add it to promiseArray.
            // One example is when we get probes / seed points.
            if (selectedParameters[paramName].type == "voxelIndex") {
                // Create a closure to keep the parameter name associated with the promise created below.
                (function (pName) {
                      var frame = $("#imageWrapper1")[0];
                      var element = cornerstoneLayers.getImageElement(frame);
                      var probeToolState = cornerstoneTools.getToolState(element, 'probe');
                      var stackToolState = cornerstoneTools.getToolState(element, 'stack');
                      if (undefined != probeToolState) {
                          // var x = Math.round(probeToolState.data[0].handles.end.x);
                          // var y = Math.round(probeToolState.data[0].handles.end.y);
                          var z = stackToolState.data[0].currentImageIdIndex;
                          promiseArray.push(imageViewers.getProbes(stackToolState.data[0].stackId, pName)
                              .then(function(result) {
                                  selectedParameters[pName].default = result.probeList[0];
                              }));
                          // No .catch is needed here.  An error returned from the promise is propagated all the way out.
                      }
                 })(paramName);
            }
            if (selectedParameters[paramName].type == "series") {
              if (selectedSeries.length == 1)
                selectedParameters[paramName].default = selectedSeries[0];
              else // Put the entire list.
                selectedParameters[paramName].default = selectedSeries;
            }
          }
          Promise.all(promiseArray).then(function() {
              resolve();
          }).catch(function(error) {
              reject("autofillRadiologyParameters(), error in promiseArray: " + error);
          })
        });
    }

    this.autofillPathologyParameters = function(selectedParameters, selectedSlide, selectedRegion, selectedChannel, selectedPipeline, forceOverwrite) {
      for (var paramName in selectedParameters) {
        if (paramName == "slide") {
          selectedParameters[paramName].default = selectedSlide;
        }
        if (paramName == "region") {
          selectedParameters[paramName].default = selectedRegion;
        }
        if (paramName == "channel") {
          selectedParameters[paramName].default = selectedChannel;
        }
        if (paramName == "branch") {
          selectedParameters[paramName].default = selectedPipeline;
        }
        if (paramName == "force") {
          selectedParameters[paramName].default = forceOverwrite;
        }
      }
    }

    this.requestAlgoRun = function(selectedParameters, selectedAlgo) {
      var keyList = Object.keys(selectedParameters);
      var paramLength = keyList.length
      var context_data = {};
      for (var i = 0; i < paramLength; i++) {
        var param = keyList[i];
        var required = selectedParameters[param].required;
        var include = selectedParameters[param].include;
        var thisValue = selectedParameters[param].default;
        var value = thisValue;
        if (required || include) {
            context_data[param] = value;
        }
      }
      var selectedAlgoName;
      if (selectedAlgo.isArray) {
        selectedAlgoName = selectedAlgo[0];
      } else {
        selectedAlgoName = selectedAlgo;
      }
      var http_data = {
        "analyticId": {
          "name": selectedAlgoName,
          "version": selectedAlgo.split('--')[1].replace(/_/g, '.') // Consul encodes version in the name
        },
        "context": context_data
      };
      $http.post(utilityFns.rt106_server_url() + '/v1/execution', http_data)
        .then(
          function(response) {
            // success callback
            $log.log('Post to /v1/execution succeeded. ', response);
          },
          function(response) {
            // failure callback
            $log.error('Post to /v1/execution failed. ', response);
            alarmService.displayAlert('Request to run algorithm failed');
          }
        );
    };

  }]);

}));
