// Copyright (c) General Electric Company, 2017.  All rights reserved.

// make this module work with RequireJS or as a browser global
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define(['angular', '../module'], factory);
  } else {
    // Browser globals
    root.utilityFns = factory(angular, angular.module('rt106'));
  }
}(this, function(angular, mod) {

  'use strict';

  mod.service('utilityFns', ['$location', 'Rt106_SERVER_URL', function($location, Rt106_SERVER_URL) {

    this.getObjectIndexByValue = function(struct, field, value) {
      for (var i = 0; i < struct.length; i++) {
        if (struct[i][field] == value) {
          return i;
        }
      }
      return -1;
    }

    this.requestPathologyImageString = function(imageFormat, accessString) {
        var suffixFormat = imageFormat;
        if (suffixFormat.slice(-1) == ':') {
            // If the format ends with a colon, trim it off.
            suffixFormat = suffixFormat.substring(0, suffixFormat.length-1);
        }
        var urlstring = imageFormat + this.rt106_server_url().split(':').slice(1).join(':') + "/v1/datastore/instance" + accessString + '/' + suffixFormat;
      return urlstring;
    }

    /*
     * Function to work with ng-scrollbar to update a scrollbar when the contents of its list dynamically change.
     */
    this.updateScroll = function(ngScope) {
      ngScope.$broadcast('rebuild:me');
    }

    /*
     * Simple JavaScript object equivalence function from http://adripofjavascript.com/blog/drips/object-equality-in-javascript.html.
     * Note limitations:  This does not work for objects within objects or NaN / undefined values.
     */
    this.isEquivalent = function(a, b) {
      // Create arrays of property names
      var aProps = Object.getOwnPropertyNames(a);
      var bProps = Object.getOwnPropertyNames(b);
      // If number of properties is different,
      // objects are not equivalent
      if (aProps.length != bProps.length) {
        return false;
      }
      for (var i = 0; i < aProps.length; i++) {
        var propName = aProps[i];

        // If values of same property are not equal,
        // objects are not equivalent
        if (a[propName] !== b[propName]) {
          return false;
        }
      }
      // If we made it this far, objects
      // are considered equivalent
      return true;
    }

    // Edit list of algorithms ($scope.algorithms) to add any new algorithms and remove any that are no longer available.
    // Merging the list instead of just setting $scope.algorithms = analytics
    // allows us to maintain which algorithms have their parameters expanded.
    // For this function, the lists must have a key element called "name".
    this.mergeAnalyticsLists = function(masterList, newList, selectionList) {
        // First, look for new analytics to add.
        for (let i = 0; i < newList.length; ++i) {
            let algoIndex = this.getObjectIndexByValue(masterList, 'name', newList[i].name);
            if (algoIndex === -1) {
                masterList.push(newList[i]);
            }
        }
        // Next, look for newList items that are no longer available and remove them from the list.
        for (let i = 0; i < masterList.length; ++i) {
            let name = masterList[i].name;
            let algoIndex = this.getObjectIndexByValue(newList, 'name', name);
            if (algoIndex === -1) {
                masterList.splice(i, 1);
                // remove from the list of selectedAlgos if there as well
                var sindex = selectionList.indexOf(name);
                if (sindex !== -1) {
                    selectionList.splice(sindex, 1);
                }
            }
        }

    }

    this.rt106_server_url = function() {
        return $location.protocol() + '://' + $location.host() + ':' + $location.port();
    }



  }]);
}));
