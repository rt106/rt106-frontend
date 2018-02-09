// Copyright (c) General Electric Company, 2017.  All rights reserved.

// make this module work with RequireJS or as a browser global
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['angular', '../module'], factory);
    } else {
        // Browser globals
        root.alarmService = factory(angular, angular.module('rt106'));
    }
}(this, function(angular, mod) {

    'use strict';

    mod.service('alarmService', ['$http', '$log', 'Rt106_SERVER_URL', 'utilityFns', function($http, $log, Rt106_SERVER_URL, utilityFns) {

        var self = this;

        /*
         * To display alerts within this service, use self.displayAlert(str);
         */

        this.alertText = "";
        this.showAlertCondition = false;
        this.alertTime = 0;

        this.displayAlert = function(str) {
            this.alertText = str;
            this.showAlertCondition = true;
            this.alertTime = new Date();
        };

        //var checkSeconds = 2;
        var displayedBadItems = [];

        this.scanForHealth = function() {
            // The line below is just for testing that the alert can be displayed from within this same service.
            //self.displayAlert("Calling scanForHealth() in alarmService");
            // Ask for the list of bad services.
            $http.get(utilityFns.rt106_server_url() + '/v1/health/bad')
                .then(function(result) {
                    var badServices = result.data;
                    if (badServices.length > 0) {
                        $log.log("In alarm service, bad services are " + JSON.stringify(badServices));
                    }
                    // Compare each item in badServices with displayStatus array.
                    for (var badIndex=0; badIndex<badServices.length; badIndex++) {
                        var thisBadItem = badServices[badIndex].name;
                        if (displayedBadItems.indexOf(thisBadItem) == -1) {
                            $log.log("Adding " + thisBadItem + " to list of displayed bad items.");
                            displayedBadItems.push(thisBadItem);
                            self.displayAlert("ALARM: " + thisBadItem + " is not responding.");
                        } else {
                            $log.log("Not adding " + thisBadItem + " to list, already there.");
                        }
                    }
                    // See if any items in displayedBadItems are not in badServices and should therefore be removed.
                    for (var badDisplayedIndex=0; badDisplayedIndex<displayedBadItems.length; badDisplayedIndex++) {
                        var thisBadDisplayedItem = displayedBadItems[badDisplayedIndex];
                        var found = false;
                        for (var badServiceIndex=0; badServiceIndex<badServices.length; badServiceIndex++) {
                            var thisBadService = badServices[badServiceIndex];
                            if (thisBadDisplayedItem == thisBadService.name) {
                                found = true;
                                break;
                            }
                        }
                        if (found == false) {
                            // The bad service that has been displayed is no longer bad.  Remove it from the list.
                            displayedBadItems[badDisplayedIndex] = "";
                        }
                    }
                }, function(err) {
                    self.displayAlert("Error getting list of unhealthy services.");
                    $log.error('/v1/health/bad returned an error.', err.data);
                });
            //setTimeout(this.scanForHealth, checkSeconds*1000);
        }

    }]);

}));
