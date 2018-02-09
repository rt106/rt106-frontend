// Copyright (c) General Electric Company, 2017.  All rights reserved.

// make this module work with RequireJS or as a browser global
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define(['angular', '../module'], factory);
  } else {
    // Browser globals
    root.analyticsFactory = factory(angular, angular.module('rt106'));
  }
}(this, function(angular, mod) {

  'use strict';

  mod.factory('analyticsFactory', ['$http', '$location', '$q', '$log', 'alarmService','dynamicDisplayService', 'utilityFns', 'Rt106_SERVER_URL', function($http, $location, $q, $log, alarmService, dynamicDisplayService, utilityFns, Rt106_SERVER_URL) {

    var factory = {};

    // return a promise for the list of analytics
    factory.getAnalytics = function() {
      var deferred = $q.defer();
      /*
       * Map from  Rt106 parameter types to an HTML input types.
       */
      var mapRt106TypeToHTML = function(type) {
        if (type == "number") return "number";
        else if (type == "voxelIndex") return "text"; // wire to seed point picker
        else if (type == "series") return "text"; // wire to currently-selected series
        else if (type == "boolean") return "checkbox";
        else return "text"; // by default, assume a  value that can be entered in a text box.
      }

      var analytics = [];
      var prune = [];
      var responsesCount = 0;
      var responsesExpected = 99999;

      /*
       * Initialize the analytics variable to contain the metadata for the list of analytics.
       */
      $http.get(utilityFns.rt106_server_url() + '/v1/analytics')
        .then(function(result) {
          for (var analytic in result.data) {
            var analytic_data = {
              'name': analytic,
              'enabled': true,
              'parameters': {},
              'results': {},
              'display': {},
              'classification': ''
            }
            analytics.push(analytic_data);
          }
          responsesExpected = analytics.length * 4;
          for (var i = 0; i < analytics.length; i++) {
            var analyticName = analytics[i].name;
            // Closure to ensure the proper value of analyticName is available when the asynchronous response is recvd
            (function(analyticName) {
              // Get the parameters for each algorithm.
              $http.get(utilityFns.rt106_server_url() + '/v1/analytics/' + analyticName + '/parameters')
                .then(function(result) {
                  responsesCount++;
                  var algoParamsObj = result.data;
                  // Get the list of required parameters.
                  for (var algoName in algoParamsObj) {
                    // There should be just one algorithm name based on the defined parameter protocol, but this loop could work in the general case.
                    // (algoName may not match analyticName, so we need to use analyticName.  See Closure above.)
                    var paramsObj = algoParamsObj[algoName];
                    var index = utilityFns.getObjectIndexByValue(analytics, 'name', analyticName);
                    if (index < 0) {
                      $log.error("init() -- This line should not execute (getting parameters).");
                      alarmService.displayAlert("Internal error getting analytic list -- contact Rt106 developers.");
                    }
                    // Get the list of parameters that are required.
                    var required = [];
                    for (let param in paramsObj) {
                      // The 'required' list will be in the list at the same level as the parameters themselves.
                      if (param === 'required') {
                        required = paramsObj[param];
                        break;
                      }
                    }
                    // Set the widgetType for each parameter.
                    for (let param in paramsObj) {
                      if (param === 'required') {
                        // 'required' is not actually a parameter.
                        continue;
                      }
                      var paramStruct = paramsObj[param];
                      var t = paramStruct.type;
                      paramStruct.widgetType = mapRt106TypeToHTML(t);
                      if (required.indexOf(param) == -1) {
                        // This parameter is not required.
                        paramStruct.required = false;
                      } else {
                        // This parameter is required.
                        paramStruct.required = true;
                      }
                    }
                    // Remove the 'required' element from the parameter list.  It has already been processed.
                    delete paramsObj.required;
                    analytics[index].parameters = paramsObj;
                  }
                  if (responsesCount == responsesExpected) {
                    var good = analytics.filter(function(elem, index, analytics) {
                      return prune.indexOf(elem.name) < 0;
                    });
                    deferred.resolve(good); // resolve when last REST call returns, even if error
                  }
                }, function(err) {
                  $log.error("/v1/analytics/" + analyticName + "/parameters returned an error.", err.data);
                  alarmService.displayAlert("Error getting parameter list for " + analyticName);
                    responsesCount++;
                  prune.push(analyticName);
                  if (responsesCount == responsesExpected) {
                    var good = analytics.filter(function(elem, index, analytics) {
                      return prune.indexOf(elem.name) < 0;
                    });
                    deferred.resolve(good); // resolve when last REST call returns, even if error
                  }
                });
              // Get the results for each algorithm.
              $http.get(utilityFns.rt106_server_url() + '/v1/analytics/' + analyticName + '/results')
                .then(function(result) {
                  responsesCount++; // TODO:  Should this be initialized back to zero?
                  var algoResultsObj = result.data;
                  for (var algoName in algoResultsObj) {
                    // There should be just one algorithm name based on the defined parameter protocol, but this loop could work in the general case.
                    // (algoName may not match analyticName, so we need to use analyticName.  See Closure above.)
                    var resultsObj = algoResultsObj[algoName];
                    var index = utilityFns.getObjectIndexByValue(analytics, 'name', analyticName);
                    if (index < 0) {
                      $log.error("init() -- This line should not execute (getting parameters).");
                    }
                    // Set the widgetType for each parameter.
                    for (var r in resultsObj) {
                      var resultStruct = resultsObj[r];
                      var t = resultStruct.type;
                      resultStruct.widgetType = mapRt106TypeToHTML(t);
                    }
                    analytics[index].results = resultsObj;
                  }
                  if (responsesCount == responsesExpected) {
                    var good = analytics.filter(function(elem, index, analytics) {
                      return prune.indexOf(elem.name) < 0;
                    });
                    deferred.resolve(good); // resolve when last REST call returns, even if error
                  }
                }, function(err) {
                  $log.error("/v1/analytics/" + analyticName + "/results returned an error.", err.data);
                  alarmService.displayAlert("Error getting results structure for " + analyticName);
                  responsesCount++;
                  prune.push(analyticName);
                  if (responsesCount == responsesExpected) {
                    var good = analytics.filter(function(elem, index, analytics) {
                      return prune.indexOf(elem.name) < 0;
                    });
                    deferred.resolve(good); // resolve when last REST call returns, even if error
                  }
                });
              // Get the result display format for each algorithm.
              $http.get(utilityFns.rt106_server_url() + '/v1/analytics/' + analyticName + '/results/display')
                .then(function(result) {
                  responsesCount++;
                  var algoDisplayObj = result.data;
                  for (var algoName in algoDisplayObj) {
                    // There should be just one algorithm name based on the defined display protocol, but this loop could work in the general case.
                    var displayObj = algoDisplayObj[algoName];
                    var index = utilityFns.getObjectIndexByValue(analytics, 'name', analyticName);
                    if (index < 0) {
                      $log.error("init() -- This line should not execute (getting results/display).");
                      reject(analytics);
                    }
                    analytics[index].display = displayObj;
                  }
                  if (responsesCount == responsesExpected) {
                    var good = analytics.filter(function(elem, index, analytics) {
                      return prune.indexOf(elem.name) < 0;
                    });
                    deferred.resolve(good); // resolve when last REST call returns, even if error
                  }
                }, function(err) {
                  $log.error("/v1/analytics/" + analyticName + "/results/display returned an error.", err.data);
                  alarmService.displayAlert("Error getting result display structure for " + analyticName);
                  responsesCount++;
                  prune.push(analyticName);
                  if (responsesCount == responsesExpected) {
                    var good = analytics.filter(function(elem, index, analytics) {
                      return prune.indexOf(elem.name) < 0;
                    });
                    deferred.resolve(good); // resolve when last REST call returns, even if error
                  }
                }
              );
              // Get the classification for each algorithm.
              $http.get(utilityFns.rt106_server_url() + '/v1/analytics/' + analyticName + '/classification')
                .then(function(result) {
                  responsesCount++;
                  var algoClass = result.data;
                  for (var algoName in algoClass) {
                    // There should be just one algorithm name based on the defined display protocol, but this loop could work in the general case.
                    var classObj = algoClass[algoName];
                    var index = utilityFns.getObjectIndexByValue(analytics, 'name', analyticName);
                    if (index < 0) {
                      $log.error("init() -- This line should not execute (getting classification).");
                      reject(analytics);
                    }
                    analytics[index].classification = classObj;
                  }
                  if (responsesCount == responsesExpected) {
                    var good = analytics.filter(function(elem, index, analytics) {
                      return prune.indexOf(elem.name) < 0;
                    });
                    deferred.resolve(good); // resolve when last REST call returns, even if error
                  }
                }, function(err) {
                  analytics[index].classification = "unknown";
                  $log.error("/v1/analytics/" + analyticName + "/results/display returned an error.", err.data);
                  alarmService.displayAlert("Error getting classification for " + analyticName);
                  responsesCount++;
                  prune.push(analyticName);
                  if (responsesCount == responsesExpected) {
                    var good = analytics.filter(function(elem, index, analytics) {
                      return prune.indexOf(elem.name) < 0;
                    });
                    deferred.resolve(good); // resolve when last REST call returns, even if error
                  }
                }
              );
            })(analyticName);
          }
        }, function(err) {
          $log.error("/v1/analytics returned an error.", err.data);
          alarmService.displayAlert("Error getting list of analytics");
          deferred.reject(["/v1/analytics returned an error.", err.data]);
        });

      return deferred.promise;
    }

   return factory;
  }]);
}));
