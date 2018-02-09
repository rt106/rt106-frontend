// Copyright (c) General Electric Company, 2017.  All rights reserved.

// make this module work with RequireJS or as a browser global
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
      // AMD. Register as an anonymous module.
      define(['angular', '../module'], factory);
    } else {
      // Browser globals
      root.pathologyService = factory(angular, angular.module('rt106'));
    }
  }(this, function(angular, mod) {

    'use strict';

    mod.service('pathologyService', ['$http', '$log', 'alarmService', 'utilityFns', 'Rt106_SERVER_URL', function($http, $log, alarmService, utilityFns, Rt106_SERVER_URL) {


      var slides = ["not ready"];
      var regions = ["not ready"];
      var channels = ["not ready"];

      /*
      $http.get(utilityFns.rt106_server_url() + '/v1/datastore/pathology/slides')
        .then(function(result) {
          slides = result.data;
        }, function(err) {
          $log.error('/v1/datastore/pathology/slide returned an error.', err.data);
          alarmService.displayAlert('Error getting list of slides');
        });

      var getRegions = function(slide) {
        $http.get(utilityFns.rt106_server_url() + '/v1/datastore/pathology/slides/' + slide + '/regions')
          .then(function(result) {
            regions = result.data;
          }, function(err) {
            $log.error('/v1/datastore/pathology/slides/' + slide + '/regions returned an error.', err.data);
            alarmService.displayAlert('Error getting list of regions for ' + slide);
          });
      }

       var getChannels = function(slide, region) {
       $http.get(utilityFns.rt106_server_url() + '/v1/datastore/pathology/slides/' + slide + '/regions/' + region + '/channels')
       .then(function(result) {
       channels = result.data;
       //channels.unshift("DAPI");
       }, function(err) {
       $log.error('/v1/datastore/pathology/slides/' + slide + '/regions/' + region + '/channels returned an error.', err.data);
       alarmService.displayAlert('Error getting list of channels for slide ' + slide + ' / region ' + region);
       });
       }

      this.getSlideList = function() {
        return slides;
      };

       this.getRegionList = function(slide) {
       getRegions(slide);
       return regions;
       }

       */

      this.getSlideList = function() {
        var promise = new Promise(function(resolve, reject) {
            var querystring = utilityFns.rt106_server_url() + '/v1/datastore/pathology/slides'
            $http.get(querystring)
                .then(function(result) {
                    slides = result.data;
                    resolve(slides);
                }, function(err) {
                    var errorstring = querystring + ' returned an error. ' + err.data;
                    $log.error(errorstring);
                    alarmService.displayAlert('Error getting list of slides: ' + querystring);
                    reject(errorstring);
                });
        });
        return promise;
      }

      this.getRegionList = function(slide) {
          var promise = new Promise(function(resolve, reject) {
              var querystring = utilityFns.rt106_server_url() + '/v1/datastore/pathology/slides/' + slide + '/regions';
              $http.get(querystring)
                  .then(function(result) {
                      regions = result.data;
                      resolve(regions);
                  }, function(err) {
                      var errorstring = queryString + ' returned an error. ' + err.data;
                      $log.error(errorstring);
                      alarmService.displayAlert('Error getting list of regions for ' + slide);
                      reject(errorstring);
                  });
          });
          return promise;
        }

      this.getChannelList = function(slide, region) {
          var promise = new Promise(function(resolve, reject) {
              var querystring = utilityFns.rt106_server_url() + '/v1/datastore/pathology/slides/' + slide + '/regions/' + region + '/channels';
              $http.get(querystring)
                  .then(function(result) {
                      channels = result.data;
                      resolve(channels);
                  }, function(err) {
                      var errorstring = querystring + ' returned an error. ' + err.data;
                      $log.error(errorstring);
                      alarmService.displayAlert('Error getting list of channels for slide ' + slide + ' / region ' + region);
                      reject(errorstring);
                  });
          });
          return promise;
      }

      this.getPrimaryImagePath = function(slide, region, channel) {
          var pathPromise = new Promise(function(resolve, reject) {
              var querystring = utilityFns.rt106_server_url() + '/v1/datastore/pathology/slides/' + slide + '/regions/' + region + '/channels/' + channel + '/image';
              $http.get(querystring)
                  .then(function(result) {
                      var path = result.data;
                      // Return a promise for path.
                      resolve(path);
                  }, function(err) {
                      var errorstring = querystring + ' returned an error.' + err.data;
                      $log.error(errorstring);
                      alarmService.displayAlert('Error getting path for ' + querystring);
                      reject(errorstring);
                  });
          });
          return pathPromise;
      }

    }]);

  }));
