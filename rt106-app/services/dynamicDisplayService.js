// Copyright (c) General Electric Company, 2017.  All rights reserved.

// make this module work with RequireJS or as a browser global
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define(['angular', '../module'], factory);
  } else {
    // Browser globals
    root.dynamicDisplayService = factory(angular, angular.module('rt106'));
  }
}(this, function(angular, mod) {

  'use strict';

  mod.service('dynamicDisplayService', ['$http', '$log', 'alarmService', 'utilityFns', 'Rt106_SERVER_URL', function($http, $log, alarmService, utilityFns, Rt106_SERVER_URL) {

    // constants
    var colorDefault = 'white';
    var opacityDefault = 1.0;
    var imageProcessingDefault = "none";
    var imageFormatDefault = "http:"; // maps to DICOM

    /*
     * Functions used internally by this service.
     * Some of these functions are limited to image grids of only (1,1), (1,2), (2,1), and (2,2).  This needs to be generalized.
     */

    var renderStackInViewer = function(imageFormat, accessPath, viewerID, displayStructElement, color, opacityValue, imageProcessing, detections) {
      $log.log("top of dynamicDisplayService.renderStackInViewer, accessPath is " + accessPath + ", imageFormat is " + imageFormat + ", viewerID is " + viewerID + ", displayStructElement is " + displayStructElement + ", color is " + color + ", opacityValue is " + opacityValue + ", detections is " + detections);
      //var stackId = [patientName, studyName, seriesName];
      var stackId = accessPath;
      //debugger;
      return imageViewers.checkCache(stackId)
        .then(function(ids) {
          return imageViewers.loadAndViewStack(ids, imageViewers.stackViewers[viewerID], stackId, displayStructElement, color, opacityValue, imageProcessing, detections).then(function() {
            return stackId;
          })
          .catch(function(error) {
            return Promise.reject(error);
          });
        })
        .catch(function(reason) {
          $log.log('Series not cached. Loading ' + stackId);
          var series = accessPath
          if (imageFormat == "http:") { // DICOM images
            return $http.get(Rt106_SERVER_URL + "/v1/datastore/series" + series + '/instances')
              .catch(function(err) {
                $log.error("Error getting the instances for a series: " + JSON.stringify(err));
                alarmService.displayAlert('Error getting the instances for series');
                return Promise.reject(err);
              })
              .then(function(response) {
                  var imageIds = [];
                  $.each(response.data.paths, function(index, instance) {
                    var format  = imageFormat;
                    if (format === "http:") {
                      if (Rt106_SERVER_URL.split(':')[0] === "https") {
                        format = "https:"
                      }
                    }
                    var urlstring = format + Rt106_SERVER_URL.split(':').slice(1).join(':') + "/v1/datastore/instance" +  instance + '/DICOM';
                    imageIds.push(urlstring);
                  });

                  return imageViewers.loadAndViewStack(imageIds, imageViewers.stackViewers[viewerID], stackId, displayStructElement, color, opacityValue, imageProcessing, detections)
                    .then(function() {
                      return stackId;
                    })
                    .catch(function(error) {
                      $log.log('Stack ' + stackId + ' cannot be rendered in the viewer. ' + error);
                      alarmService.displayAlert('Stack ' + stackId + ' cannot rendered in the viewer. ' + error);
                      return Promise.reject(error);
                    });
                });
          } else if (imageFormat == "tiff16:" || imageFormat == "tiff:") {
            // Just one image, not a stack as in DICOM.
            $log.log("dynamicDisplayService.renderStackInViewer(), imageFormat is " + imageFormat + ", trying to load " + accessPath);
              var pathologyImageString = utilityFns.requestPathologyImageString(imageFormat, accessPath);
              $log.log("pathologyImageString is " + pathologyImageString);
              var imageIds = [];
              imageIds.push(pathologyImageString);
              // BDS:  Changed below from stackId[0] -- test this
            return imageViewers.loadAndViewStack(imageIds, imageViewers.stackViewers[viewerID], stackId, displayStructElement, color, opacityValue, imageProcessing, detections).then(function() {
              return stackId;
            });
          } else {
            $log.log("Unsupported image type");
            alarmService.displayAlert("Unsupported image type");
            throw err;
          }
        });
    }

    // This function does not work in the general case.  It is limited to shapes of 1,1 1,2 2,1 and 2,2.
    var getViewerID = function(col, row, shape) {
      var viewerID = 0; // Default value is 0 unless changed below.
      if (col == 0 && row == 0) {
        if (shape == "1,1" || shape == "1,2")
          viewerID = 0;
        else // 2,2 or 2,1
          viewerID = 2;
      } else if (col == 0 && row == 1) {
        if (shape == "1,2")
          viewerID = 1;
        else // 2,2
          viewerID = 4;
      } else if (col == 1 && row == 0) {
        viewerID = 3;
      } else if (col == 1 && row == 1) {
        viewerID = 5;
      }
      return viewerID;
    }

    /*
     * Display the specifified series in the appropriate image viewer with the given color & opacityValue.
     */
    var displayInCell = function(imageFormat, accessPath, displayStructElement, col, row, shape, color, opacityValue, imageProcessing, detections) {
      //$log.log("dynamicDisplayService.displayInCell, accessPath is " + accessPath + ", col,row is " + col + "," + row + ", shape is " + shape + ", color is " + color +
      //    ", opacityValue is " + opacityValue + ", imageProcessing is " + imageProcessing + ", imageFormat is " + imageFormat +
      //    ", displayStructElement is " + JSON.stringify(displayStructElement));

      var viewerID = getViewerID(col, row, shape);
      return renderStackInViewer(imageFormat, accessPath, viewerID, displayStructElement, color, opacityValue, imageProcessing, detections)
        .then(function(response) {
          console.log('UI now displays ' + accessPath + '.');
          return response;
        })
        .catch(function(error) {
          console.log('Cannot display ' + accessPath + ' in UI. ' + error);
          return Promise.reject(error);
        });
    }
    this.displayInCell = displayInCell;

    var clearStackByID = function(viewerID) {
      var viewer = imageViewers.stackViewers[viewerID];
      imageViewers.clearStackElements(viewer);
    }

    /*
     * Set the display shape of the image region, which is currently limited to 1 or 2 rows and columns.
     * When setting the display shape, the appropriate stacks are cleared.
     */
    this.setDisplayShape = function(shape) {

      //$log.log("entering setDisplayShape() with " + shape);
      // v1 and v2 are large viewers.  v3-v6 are small viewers.

      var v1 = document.getElementById("imageWrapper1");
      var v2 = document.getElementById("imageWrapper2");
      var v3 = document.getElementById("imageWrapper3");
      var v4 = document.getElementById("imageWrapper4");
      var v5 = document.getElementById("imageWrapper5");
      var v6 = document.getElementById("imageWrapper6");

      if (shape == '1,1') {
        // Make all but the first viewers invisible.
        v1.style.display = "block";
        v2.style.display = "none";
        v3.style.display = "none";
        v4.style.display = "none";
        v5.style.display = "none";
        v6.style.display = "none";
        clearStackByID(0);
      } else if (shape == '2,1') {
        v1.style.display = "none";
        v2.style.display = "none";
        v3.style.display = "block";
        v4.style.display = "none";
        v5.style.display = "block";
        v6.style.display = "none";
        clearStackByID(2);
        clearStackByID(4);
      } else if (shape == '1,2') {
        v1.style.display = "block";
        v2.style.display = "block";
        v3.style.display = "none";
        v4.style.display = "none";
        v5.style.display = "none";
        v6.style.display = "none";
        clearStackByID(0);
        clearStackByID(1);
      } else if (shape == '2,2') {
        v1.style.display = "none";
        v2.style.display = "none";
        v3.style.display = "block";
        v4.style.display = "block";
        v5.style.display = "block";
        v6.style.display = "block";
        clearStackByID(2);
        clearStackByID(3);
        clearStackByID(4);
        clearStackByID(5);
      } else {
        $log.error('Unsupported result display shape ' + shape);
        alarmService.displayAlert('Unsupported result display shape ' + shape);
      }
      // Clear any dynamic controls previously created.
      clearDynamicControls();
      return shape;
    }

    /*
     * Display the input and output images when an item in the execution list is clicked in GUI.
     */
    this.displayResult = function(execItem, displayStruct, detections) {
      // Get the grid-shape of the display structure.
      var shape = displayStruct.grid.shape.toString();
      if (!shape) {
        $log.error("Grid-shape of the display structure is not defined");
        alarmService.displayAlert("Grid-shape of the display structure is not defined");
      }
      this.setDisplayShape(shape);

      // imageViewerController and the underlying CornerstoneLayers code presumes
      // a layered visualization is constructed synchronously. The code below uses
      // Promise chaining to ensure that each entry in the result display is completed
      // before another starts.  We could limit this promise chaining to just chain
      // the layers within a given cell.
      function cell(displayStructElement, shape) {
        return new Promise(function(resolve, reject) {
          //var cellDisplayMode = displayStructElement.cellDisplayMode;
          var cellType = displayStructElement.cellType;
          var source = displayStructElement.source;
          var parameter = displayStructElement.parameter;
          var imageFormat = imageFormatDefault;
          // Set properties to defaults, then change if appropriate.
          var color = colorDefault;
          var opacity = opacityDefault;
          var imageProcessing = imageProcessingDefault;
          // color property for RGB images needs to be undefined to avoid special handling
          if (displayStructElement.cellType === "pathologyImageRGB") {
              color = undefined;
          }
          if (displayStructElement.properties !== undefined) {
              if (displayStructElement.cellType !== "pathologyImageRGB" && displayStructElement.properties.color !== undefined && displayStructElement.properties.color !== "undefined") {
                  color = displayStructElement.properties.color;
              }
              if (displayStructElement.properties.opacity !== undefined && displayStructElement.opacity !== "undefined") {
                  opacity = displayStructElement.properties.opacity;
              }
              if (displayStructElement.imageProcessing !== undefined && displayStructElement.imageProcessing !== "undefined") {
                  imageProcessing = displayStructElement.imageProcessing;
              }
          }
          $log.log("dynamicDisplayService.displayResult, imageProcessing is " + imageProcessing);

          if (cellType == "image" || cellType == "pathologyImage" || cellType == "pathologyImageRGB") {
            if (cellType == "image") {
              imageFormat = "http:";
            } else if (cellType == "pathologyImage") {
              imageFormat = "tiff16:";
            } else if (cellType == "pathologyImageRGB") {
              imageFormat = "tiff:";
            }
            // Iterate through execItem.details.
            var parameterValue = "unknown";
            for (var l = 0; l < execItem.details.length; l++) {
              if (execItem.details[l].source == source && execItem.details[l].name == parameter) {
                parameterValue = execItem.details[l].value;
                displayInCell(imageFormat, parameterValue, displayStructElement, displayStructElement.column, displayStructElement.row, shape, color, opacity, imageProcessing, detections).then(function() {
                  resolve(displayStructElement);
                })
                .catch(function(reason){
                  reject(reason);
                });
                break;
              }
            }
            if (parameterValue == "unknown") {
              $log.error("No value found for column " + displayStructElement.column + " and row " + displayStructElement.row);
            }
          }
        })
      }
      var sequence = Promise.resolve();
      displayStruct.cells.forEach(function(displayStructElement) {
        sequence = sequence.then(function() {
          return cell(displayStructElement, shape)
        }).then(function(displayStructElement) {
          //$log.log('Displayed element ', displayStructElement)
        })
      });

      return shape;
    }

  }]);

}));
