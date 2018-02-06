// Copyright (c) General Electric Company, 2017.  All rights reserved.

var test_error = false

if (typeof imageViewers === 'undefined') {
  var imageViewers = {
    internal: {},

    // variables for managing cornerstone viewers (right spot? move to internal?) - jvm
    stacks: [],
    stackViewers: [],
    imageViewers: [],

    // Configurable callback to display alert.
    displayAlert: function(str) {
      console.log("alert: " + str);
    }
  };
}


// Notes on callbacks, configuration, and initialization
//
// 1. There are things that need to be configured once the page is loaded (activate tools and set up most of the callbacks).
// 2. There are things that need to be configured once an image is loaded (setup roi tools, etc.).
// 3. There are things that need to be done each time an image (slice) is changed (reset the wwwc to DICOM fields).
// 4. There are things that need to be done each time the mouse is moved (update text on coords).
// 5. There are things that need to be done on every render (update text on wwwc and zoom. can this be done elsewhere?).


/**
 *  Internal routine to configure the platform. Mainly configures Cornerstone.
 */
(function(imageViewers) {

  "use strict";

  function configure() {
    var config = {
      minScale: 0.05,
      maxScale: 20.0,
      preventZoomOutsideImage: true
    };

    cornerstoneTools.zoom.setConfiguration(config);
    cornerstoneTools.length.setConfiguration({
      shadow: true
    });
    cornerstoneTools.angle.setConfiguration({
      shadow: true
    });
    cornerstoneTools.probe.setConfiguration({
      shadow: true
    });
    cornerstoneTools.ellipticalRoi.setConfiguration({
      shadow: true
    });
    cornerstoneTools.rectangleRoi.setConfiguration({
      shadow: true
    });
    cornerstoneTools.stackScroll.setConfiguration({
      stackScrollSpeed: 5
    }); // 5 pixels per slice
    cornerstoneTools.toolColors.setToolColor('#e4ad00');

  }

  // module/private exports
  imageViewers.configure = configure;

}(imageViewers));


/**
 * Add the function to display alerts.
 */
(function(imageViewers) {

    "use strict";

    function configureAlert(fn) {
        imageViewers.displayAlert = fn;
    };

    // module/private exports
    imageViewers.configureAlert = configureAlert;

}(imageViewers));


/**
 * Add a stack to the managed set.  A stack is a collection of images that can be
 * scrolled, i.e. a DICOM image series. Parameter "stack" is an object that contains
 * a list of imageIds as well as other meta data about the stack (stackId, currentImageIndex).
 */
(function(imageViewers) {

  "use strict";

  function addStack(stack) {
    imageViewers.stacks[stack.stackId] = stack;
  };

  // module/private exports
  imageViewers.addStack = addStack;

}(imageViewers));


/**
 * Order the images in a stack.  Images are loaded asynchronously need to be ordered after loading.
 * Order by instance number for now. Instance number ordering is not always robust. Typically, we
 * would order by ImagePositionPatient.
 *
 * returns a promise that is resolved once the stack has been ordered.
 */
(function(imageViewers) {

  "use strict";


  function orderStack(stackId) {
      var orderPromise = new Promise(function(resolve, reject) {
          var promises = [];
          var sortedImageIds = [];
          if (stackId in imageViewers.stacks) {
              $.each(imageViewers.stacks[stackId].imageIds, function(index, imageId) {
                  var imgPromise = cornerstoneLayers.loadImage(imageId);
                  promises.push(imgPromise);
                  imgPromise.then(function(image) {
                      if (image.data === undefined) {
                          sortedImageIds[0] = imageId; // For TIFF images, only one file, not a stack.
                      } else {
                          sortedImageIds[image.data.intString("x00200013")] = imageId; // x00200013 is the instance number
                      }
                  }).catch(function(error) {
                      console.log("error getting image " + imageId + " with error " + error);
                      reject("error getting image " + imageId + " with error " + error);
                  });
              });
              Promise.all(promises).then(function() {
                  var indexArray = [];
                  for (var item in sortedImageIds) {
                      indexArray.push(sortedImageIds[item]);
                  }
                  imageViewers.stacks[stackId].imageIds = indexArray;
                  resolve();
              }).catch(function(error) {
                  reject("orderStack(), error in promises: " + error);
              })
          }
      });
      return orderPromise;
  }

  // module/private exports
  imageViewers.orderStack = orderStack;

}(imageViewers));


/**
 * Set color to a stack of images from the user input of color picker
 */
(function(imageViewers) {

  "use strict";

  function setStackColor(stackId, color) {
    // loop all the images in the stack
    if (stackId in imageViewers.stacks) {
      imageViewers.stacks[stackId].color = color;
      $.each(imageViewers.stacks[stackId].imageIds, function(index, imageId) {
        var imgPromise = cornerstoneLayers.loadImage(imageId); // should already be cached, just need to retrieve the promise
        imgPromise.then(function(image) {
          // configure the render method to color the image IF it is a color image
          if (imageViewers.stacks[stackId].color !== undefined) {
            if (image.color) {
              overlayTools.imageProcessors.toMonochromaticOverlay(image, image.getPixelData(), imageViewers.stacks[stackId].color);
            } else {
              image.render = overlayTools.getRenderOverlayImage(imageViewers.stacks[stackId].color);
            }
          }
        });
      });
    }
  };

  // module/private exports
  imageViewers.setStackColor = setStackColor;

}(imageViewers));


/**
 * Add a viewer to be managed. Takes the id of an element that is serving as a container for an
 * image as well as text annotations.
 *
 * Element has children with classes image, imageText, coordsText, wwwcText, and zoomText.
 */
(function(imageViewers) {

  "use strict";

  function addStackViewer(element) {
    //console.log("Calling addStackViewer with " + JSON.stringify(element));
    imageViewers.stackViewers.push({
      viewer: element,
      configured: false,
      loaded: false,
      elements: [],
      stackIds: []
    });
  };

  // module/private exports
  imageViewers.addStackViewer = addStackViewer;

}(imageViewers));


/**
 * create an image viewer.
 *
 * Element has three children: Scene, Controls, and Info.
 */
(function(imageViewers) {

  "use strict";

  function createImageViewer(sectionIdString, elementIdString) {
    var element = document.createElement('div');
    element.style['width'] = 'inherit'; //'512px';
    element.style['height'] = 'inherit'; //'512px';
    element.style['margin'] = '10px';
    element.style['position'] = 'relative';
    element.style['display'] = 'none';
    element.className = 'imageWrapper';
    element.oncontextmenu = 'return false';
    element.id = elementIdString;
    element.unselectable = 'on';
    element.onselectstart = 'return false;';
    element.onmousedown = 'return false;';
    var viewersSection = document.getElementById(sectionIdString);
    viewersSection.appendChild(element);

    //=======================================
    // Scene
    var sceneElement = document.createElement('div');
    sceneElement.className = "ImageViewerScene cornerstone-enabled-image";
    sceneElement.style['background-color'] = 'black';
    sceneElement.style['width'] = element.style['width'];
    sceneElement.style['height'] = element.style['height'];
    sceneElement.style['position'] = 'relative';
    sceneElement.oncontextmenu = 'return false';
    sceneElement.unselectable = 'on';
    sceneElement.onselectstart = 'return false;';
    sceneElement.onmousedown = 'return false;';
    element.appendChild(sceneElement);

    //=======================================
    // Controls
    var controlsElement = document.createElement('div');
    controlsElement.className = "ImageViewerControls";
    element.appendChild(controlsElement);

    //=======================================
    // Info
    var infoElement = document.createElement('div');
    infoElement.className = "ImageViewerInfo";
    element.appendChild(infoElement);

    //---------------------------------------
    // topleft image-annotation under element
    var topleftElement = document.createElement('div');
    topleftElement.className = "topleft image-annotation";
    topleftElement.style['position'] = 'absolute';
    topleftElement.style['top'] = '0px';
    topleftElement.style['left'] = '0px';
    sceneElement.appendChild(topleftElement);

    // patientText under topleft
    var patientTextElement = document.createElement('div');
    patientTextElement.className = "patientText";
    topleftElement.appendChild(patientTextElement);
    // studyText under topleft after patientText
    var studyTextElement = document.createElement('div');
    studyTextElement.className = "studyText";
    topleftElement.appendChild(studyTextElement);
    // seriesText under topleft after studyText
    var seriesTextElement = document.createElement('div');
    seriesTextElement.className = "seriesText";
    topleftElement.appendChild(seriesTextElement);

    //---------------------------------------
    // topright image-annotation under element
    var toprightElement = document.createElement('div');
    toprightElement.className = "topright image-annotation";
    toprightElement.style['position'] = 'absolute';
    toprightElement.style['top'] = '0px';
    toprightElement.style['right'] = '0px';
    sceneElement.appendChild(toprightElement);

    // imageText under topright
    var imageTextElement = document.createElement('div');
    imageTextElement.className = "imageText";
    toprightElement.appendChild(imageTextElement);
    // coordsText under topright after imageText
    var coordsTextElement = document.createElement('div');
    coordsTextElement.className = "coordsText";
    toprightElement.appendChild(coordsTextElement);

    //---------------------------------------
    // bottomright image-annotation under element
    var bottomrightElement = document.createElement('div');
    bottomrightElement.className = "bottomright image-annotation";
    bottomrightElement.style['position'] = 'absolute';
    bottomrightElement.style['bottom'] = '0px';
    bottomrightElement.style['right'] = '0px';
    sceneElement.appendChild(bottomrightElement);

    // zoomText under bottomright
    var zoomTextElement = document.createElement('div');
    zoomTextElement.className = "zoomText";
    bottomrightElement.appendChild(zoomTextElement);

    //---------------------------------------
    // bottomleft image-annotation under element
    var bottomleftElement = document.createElement('div');
    bottomleftElement.className = "bottomleft image-annotation";
    bottomleftElement.style['position'] = 'absolute';
    bottomleftElement.style['bottom'] = '0px';
    bottomleftElement.style['left'] = '0px';
    sceneElement.appendChild(bottomleftElement);

    // wwwcText under bottomleft
    var wwwcTextElement = document.createElement('div');
    wwwcTextElement.className = "wwwcText";
    bottomleftElement.appendChild(wwwcTextElement);

    //---------------------------------------
    // w3-progress-container under element
    var w3ProgressContainerElement = document.createElement('div');
    w3ProgressContainerElement.className = "w3-progress-container";
    $("#" + elementIdString + " " + ".ImageViewerInfo").append(w3ProgressContainerElement);

    // id imageWrapper1ProgressBar under w3-progress-container
    var progressBarElement = document.createElement('div');
    progressBarElement.className = "w3-progressbar";
    progressBarElement.style['width'] = '0%';
    progressBarElement.id = elementIdString + 'ProgressBar';
    w3ProgressContainerElement.appendChild(progressBarElement);

    // id imageWrapper1ProgressValue
    var progressValueElement = document.createElement('div');
    progressValueElement.className = "w3-container w3-text-white";
    progressValueElement.defaultValue = '0%';
    progressValueElement.id = elementIdString + 'ProgressValue';
    progressBarElement.appendChild(progressValueElement);

    // push created image viewer into the array of image viewers
    imageViewers.imageViewers.push('#' + element.id);

    imageViewers.addStackViewer('#' + element.id); // ID
    imageViewers.initializeStackViewer('#' + element.id);
  };

  imageViewers.createImageViewer = createImageViewer;

}(imageViewers));


/**
 * Initialize a viewer. Takes the id of an element that is serving as a container for an
 * image as well as text annotations.
 *
 * Element has children with classes image, imageText, coordsText, wwwcText, and zoomText.
 *
 * This routine currently assumes elements in the DOM exist for managing imaging
 * tools (#enableWindowLevelTool, #scroll, #pan, #zoom, #enableLength, #probe, #ellipseroi, etc.).
 * Click functions on these elements defined multiple times? Need to clean this up. jvm
 */
(function($, imageViewers) {

  "use strict";

  function clearStackElements(viewerElement) {
    // clear enabledFrame
    var frame = $(viewerElement.viewer)[0];
    var enabledFrame = cornerstoneLayers.getEnabledFrame(frame);

    // check if enabledFrame is undefined
    if (enabledFrame != null) {
      // call synchronizer destroy()
      enabledFrame.synchronizer.destroy();
      enabledFrame.synchronizer3.destroy();
      // clear elements
      enabledFrame.elements = [];
    }

    var imageElementCollection = frame.getElementsByClassName("imageElement");
    while (imageElementCollection[0]) {
      imageElementCollection[0].parentNode.removeChild(imageElementCollection[0]);
    }

    var imageLayersCollection = frame.getElementsByClassName("imageLayers");
    while (imageLayersCollection[0]) {
      imageLayersCollection[0].parentNode.removeChild(imageLayersCollection[0]);
    }

    viewerElement.loaded = false;
  }

  function initializeStackElement(element) {
    // Enable all tools we want to use with this element
    cornerstoneTools.wwwc.activate(element, 1); // ww/wc is the default tool for left mouse button
    cornerstoneTools.pan.activate(element, 2); // pan is the default tool for middle mouse button
    cornerstoneTools.zoom.activate(element, 4); // zoom is the default tool for right mouse button
    cornerstoneTools.zoomWheel.deactivate(element); // zoom is the default tool for middle mouse wheel (zoom direction backwards on Mac)
    cornerstoneTools.stackScrollWheel.deactivate(element); // wheel scrolls backward on Mac
    cornerstoneTools.stackScroll.enable(element);
    cornerstoneTools.stackScrollKeyboard.deactivate(element);
    cornerstoneTools.addStackStateManager(element, ['stack']);
    activate("#enableWindowLevelTool");

    function activate(id) {
      $('a').removeClass('active');
      $(id).addClass('active');
    }
    // helper function used by the tool button handlers to disable the active tool
    // before making a new tool active
    function disableAllTools() {
      cornerstoneTools.wwwc.disable(element);
      cornerstoneTools.pan.activate(element, 2); // 2 is middle mouse button
      cornerstoneTools.zoom.activate(element, 4); // 4 is right mouse button
      cornerstoneTools.zoomWheel.deactivate(element); // zoom is the default tool for middle mouse wheel (zoom direction backwards on Mac)
      if (cornerstone.getImage(element) !== undefined) {
        // these tools are only activated once an image has been loaded, therefore only deactivate if there is an image
        cornerstoneTools.probe.deactivate(element, 1);
        cornerstoneTools.length.deactivate(element, 1);
        cornerstoneTools.ellipticalRoi.deactivate(element, 1);
        cornerstoneTools.rectangleRoi.deactivate(element, 1);
        cornerstoneTools.angle.deactivate(element, 1);
        cornerstoneTools.highlight.deactivate(element, 1);
        cornerstoneTools.freehand.deactivate(element, 1);
        //cornerstoneTools.brush.deactivate(element, 1);  // JVM - calling brush.deactivate() incorrectly causes brush to display its marker (green filled circle)
      }
      cornerstoneTools.stackScroll.deactivate(element, 1);
      cornerstoneTools.stackScrollWheel.deactivate(element); // wheel scrolls backward on Mac
      cornerstoneTools.stackScrollKeyboard.deactivate(element, 1);
    }

    // Tool button event handlers that set the new active tool
    //
    $('#enableWindowLevelTool').click(function() {
      activate('#enableWindowLevelTool')
      disableAllTools();
      cornerstoneTools.wwwc.activate(element, 1);
    });
    $('#scroll').click(function() {
      activate('#scroll')
      disableAllTools();
      cornerstoneTools.stackScroll.activate(element, 1);
    });
    $('#pan').click(function() {
      activate('#pan')
      disableAllTools();
      cornerstoneTools.pan.activate(element, 3); // 3 means left mouse button or middle mouse button
    });
    $('#zoom').click(function() {
      activate('#zoom')
      disableAllTools();
      cornerstoneTools.zoom.activate(element, 5); // 5 means left mouse button or right mouse button
    });
    $('#enableLength').click(function() {
      activate('#enableLength')
      disableAllTools();
      cornerstoneTools.length.activate(element, 1);
    });
    $('#probe').click(function() {
      activate('#probe')
      disableAllTools();
      cornerstoneTools.probe.activate(element, 1);
    });
    $('#circleroi').click(function() {
      activate('#circleroi')
      disableAllTools();
      cornerstoneTools.ellipticalRoi.activate(element, 1);
    });
    $('#rectangleroi').click(function() {
      activate('#rectangleroi')
      disableAllTools();
      cornerstoneTools.rectangleRoi.activate(element, 1);
    });
    $('#angle').click(function() {
      activate('#angle')
      disableAllTools();
      cornerstoneTools.angle.activate(element, 1);
    });
    $('#highlight').click(function() {
      activate('#highlight')
      disableAllTools();
      cornerstoneTools.highlight.activate(element, 1);
    });
    $('#freehand').click(function() {
      activate('#freehand')
      disableAllTools();
      cornerstoneTools.freehand.activate(element, 1);
    });
    $('#brush').click(function() {
      // disabling brush control due to issue with brush.deactivate()
      // activate('#brush')
      // disableAllTools();
      // cornerstoneTools.brush.activate(element, 1);
    });


    $('#resetWWWCtoDICOM').click(function() {
      $.each(imageViewers.stackViewers, function(index, stackViewer) {

        var frame = $(stackViewer.viewer)[0];
        var element = cornerstoneLayers.getImageElement(frame);

        if (cornerstone.getImage(element) !== undefined) {
          imageViewers.setWWWCToDICOM(element);
        }
      });
    });
    $('#resetWWWCtoData').click(function() {
      $.each(imageViewers.stackViewers, function(index, stackViewer) {

        var frame = $(stackViewer.viewer)[0];
        var element = cornerstoneLayers.getImageElement(frame);

        if (cornerstone.getImage(element) !== undefined) {
          imageViewers.setWWWCToData(element);
        }
      });
    });

    // Additional callbacks to update annotations on the images
    $(element).on("CornerstoneImageRendered", imageViewers.internal.onImageRendered);
    $(element).mousemove(imageViewers.internal.onMouseMove);

  }

  function initializeStackViewer(viewerElement) {
    // console.log("imageViewerController.initializeStackViewer, viewerElement is " + JSON.stringify(viewerElement) + ", $(viewerElement)[0] is " + $(viewerElement)[0]);
    // find the viewerElement in the list of managed viewers
    var where;
    $.each(imageViewers.stackViewers, function(index, stackViewer) {
      if (stackViewer.viewer === viewerElement) {
        where = stackViewer;
      }
    });

    var frame = $(viewerElement)[0];
    //console.log('frame variable ' + frame);
    cornerstoneLayers.enableFrame(frame);
    where.configured = true;
  }

  // module/private exports
  imageViewers.clearStackElements = clearStackElements;
  imageViewers.initializeStackElement = initializeStackElement;
  imageViewers.initializeStackViewer = initializeStackViewer;

}($, imageViewers));


/**
 * Internal callbacks to update annotations
 */
(function($, imageViewers) {

  "use strict";

  function onImageRendered(e, eventData) {
    // set the canvas context to the image coordinate system
    if (eventData.enabledElement !== undefined) {
      cornerstone.setToPixelCoordinateSystem(eventData.enabledElement, eventData.canvasContext);
    }
    if (eventData.viewport !== undefined) {
      $(this).parent().parent().find('.wwwcText').text("WW/WC:" + Math.round(eventData.viewport.voi.windowWidth) + "/" + Math.round(eventData.viewport.voi.windowCenter));
      $(this).parent().parent().find('.zoomText').text("Zoom:" + eventData.viewport.scale.toFixed(2));
    }
  }

  function onMouseMove(event) {
    if (cornerstone.getImage(event.currentTarget) !== undefined) {
      var pixelCoords = cornerstone.pageToPixel(event.currentTarget, event.pageX, event.pageY);
      $(this).parent().parent().find('.coordsText').text("X=" + Math.round(pixelCoords.x) + ", Y=" + Math.round(pixelCoords.y));
    }
  };

  // module/private exports
  imageViewers.internal.onImageRendered = onImageRendered;
  imageViewers.internal.onMouseMove = onMouseMove;

}($, imageViewers));


/**
 * Routines to set the window/level (or window/center) for the image in an element.
 * These routine take an element of class image (as opposed to the wrapper
 * element representing the full viewer).
 */
(function(imageViewers) {

  "use strict";

  function setWWWCToDICOM(element) {
    var vp = cornerstone.getViewport(element); // method return a new object
    vp.voi.windowWidth = cornerstone.getImage(element).windowWidth;
    vp.voi.windowCenter = cornerstone.getImage(element).windowCenter;
    cornerstone.setViewport(element, vp);
  }

  function setWWWCToData(element) {
    // Sets WW leaving out the top 1% of randomly sampled pixels
    overlayTools.scaleViewport(element);
  }

  function setWWWC(element, width, center) {
    var vp = cornerstone.getViewport(element); // method return a new object
    vp.voi.windowWidth = width;
    vp.voi.windowCenter = center;
    cornerstone.setViewport(element, vp);
  }

  // module/private exports
  imageViewers.setWWWCToDICOM = setWWWCToDICOM;
  imageViewers.setWWWCToData = setWWWCToData;
  imageViewers.setWWWC = setWWWC;

}(imageViewers));


/**
 * Load images.
 *
 * loadAndCacheImage() - load an image into the application cache for later reference.
 *      imageId - the uri to the image to cache
 *      returns the promise object for the image
 *
 * loadAndViewImage() - load an image (possibly from the cache) and view it.
 *      imageId - the uri to the image to view
 *      where - the element which is the container for the image and text annotations
 *      stackId - the id of the full stack
 *      returns the promise object for the image
 *
 * trimAnnotation() - shorten a text annotation if needed and replace characters with ...
 *      string - string to process
 *      maxLength - strings longer than maxLength will have the middle of the text replaced with ...
 *      trimAnnotation() is not exported (for no particular reason), Method provided by http://stackoverflow.com/users/100473/johnvey
 */
(function($, imageViewers) {

  "use strict";

  function loadAndCacheImage(imageId, stackId) {
    // request the image to be loaded into the cache, return immediately, return the promise object
    // fallback and retry to load an image 3 times
    var retries = 3;
    var promise = $.Deferred();

    function tryLoadImage(id, tries) {
      cornerstoneLayers.loadImage(id)
        .then(function(image) {
          promise.resolve(image);
        })
        .fail(function(error) {
          --tries;
          if (tries > 0) {
            console.log('Issue loading ' + id + ', retrying (' + (retries-tries) + ')');
            setTimeout(tryLoadImage(id, tries), 1000);
          } else {
            console.log('Issue loading ' + id + ', no more attempts (' + (retries-tries) + ')');
            promise.reject(error);
          }
        });
    }

    tryLoadImage(imageId, retries);

    if (test_error) {
      if(imageId.includes('pat003') && imageId.includes('MRDC.4')){
        promise.reject();
      }
    }
    return promise;
  }

  function loadAndViewImage(imageId, where, stackId, element, frame, opacityValue, imageProcessing) {

    var promise = cornerstoneLayers.loadImage(imageId); // actually loadAndCache
    promise.then(function(image) {
      // disabling native cornerstone layering for initial release.
      // cornerstone.addLayer(element, image, {opacity: 1.0, fillStyle: imageViewers.stacks[stackId].color});  // need to add the layer to native cornerstone as well so cornerstone can manage its tools (e.g. brush) correctly

      // define callback on new image before we call displayImage()
      $(element).off('CornerstoneNewImage', onNewImage); // remove any old callback
      function onNewImage(e, data) { // define new version
        var annotationLength = 30;
        $(where.viewer + ' .imageText').text("Image #" + (imageViewers.stacks[stackId].currentImageIdIndex + 1) + "/" + imageViewers.stacks[stackId].imageIds.length + (data.image.data !== undefined ? (", Instance #" + data.image.data.intString("x00200013")) : "") );

        if (data.image.data === undefined) {
          if ( typeof stackId === 'string' ) {
            $(where.viewer + ' .patientText').text(trimAnnotation(stackId.split('/')[2], annotationLength));
            $(where.viewer + ' .studyText').text(trimAnnotation(stackId.split('/')[3], annotationLength));
            $(where.viewer + ' .seriesText').text(trimAnnotation(stackId.split('/').slice(-2)[0], annotationLength));
          } else if (stackId.constructor === Array ) {
            $(where.viewer + ' .patientText').text(trimAnnotation(stackId[0].split('/')[2], annotationLength));
            $(where.viewer + ' .studyText').text(trimAnnotation(stackId[0].split('/')[3], annotationLength));
            $(where.viewer + ' .seriesText').text(trimAnnotation(stackId[0].split('/').slice(-2)[0], annotationLength));
          }
        } else {
          $(where.viewer + ' .patientText').text(trimAnnotation(data.image.data.string('x00100020'), annotationLength));  // patient id
          $(where.viewer + ' .studyText').text(trimAnnotation(data.image.data.string('x00200010'), annotationLength));    // study id
          $(where.viewer + ' .seriesText').text(trimAnnotation(data.image.data.string('x00200011'), annotationLength));   // series number
        }

        // these tools can only be enabled once an image is loaded. but only do it once
        if (where.loaded === false) {
          cornerstoneTools.mouseInput.enable(element);
          cornerstoneTools.mouseWheelInput.enable(element);
          cornerstoneTools.probe.enable(element);
          cornerstoneTools.length.enable(element);
          cornerstoneTools.ellipticalRoi.enable(element);
          cornerstoneTools.rectangleRoi.enable(element);
          cornerstoneTools.angle.enable(element);
          cornerstoneTools.highlight.enable(element);

          where.loaded = true;
        }
      }
      $(element).on('CornerstoneNewImage', onNewImage); // add new version

      if (imageProcessing == "toBinaryImage") {
        overlayTools.imageProcessors.toBinaryImage(image, image.getPixelData())
      }

      cornerstone.displayImage(element, image);  // don't pass in a viewport and let cornerstone initialize if necessary

      cornerstoneLayers.setOpacity(element, imageViewers.stacks[stackId].opacityValue);

      cornerstoneTools.clearToolState(element, 'stack'); // jvm - this needs to be called for each element during clearStackViewer()
      cornerstoneTools.addToolState(element, 'stack', imageViewers.stacks[stackId]);

    }, function(err) {
      console.log(err);
    });

    return promise;
  }

  function trimAnnotation(string, maxLength) {
    if (!string) return string;
    if (maxLength < 1) return string;
    if (string.length <= maxLength) return string;
    if (maxLength == 1) return string.substring(0, 1) + '...';

    var midpoint = Math.ceil(string.length / 2);
    var toremove = string.length - maxLength;
    var lstrip = Math.ceil(toremove / 2);
    var rstrip = toremove - lstrip;
    return string.substring(0, midpoint - lstrip) + '...' + string.substring(midpoint + rstrip);
  }

  // module/private exports
  imageViewers.loadAndCacheImage = loadAndCacheImage;
  imageViewers.loadAndViewImage = loadAndViewImage;

}($, imageViewers));


/**
 * Load stacks.
 *
 * loadAndCacheStack() - load an image stack into the application cache for later reference.
 *      imageIds - the uris to the images to cache
 *      returns the promise object for the stackId satisfied when caching completes
 *
 * loadAndViewStack() - load an image stack (possibly from the cache) and view it.
 *      imageIds - the uris to the images to view
 *      where - the element which is the container for the image and text annotations
 *      stackId - the id of the full stack
 *      returns the promise object for the stackId satisfied when caching completes and stack is visualized
 *
 * checkCache - determine whether stack is in the cache
 *      stackId - the id of the stack
 *      returns a promise containing the imageIds in the stack if stack is in the cache
 */
(function($, imageViewers) {

  "use strict";

  function loadAndCacheStack(imageIds, stackId, color, opacityValue, where) {

    var promise = new Promise(function(resolve, reject) {
      if (stackId in imageViewers.stacks) {
        console.log('Series is already loaded ' + stackId + ", resolving promise of loadAndCacheStack");
        resolve(stackId);
      } else {
        console.log('Series not loaded. Loading ' + stackId);

        var stack = {
          stackId: stackId,
          imageIds: [],
          currentImageIdIndex: 0,
          color: color,
          opacityValue: opacityValue,
        }

        var imgPromises = [];
        $.each(imageIds, function(index, imageId) {
          imgPromises.push(imageViewers.loadAndCacheImage(imageId, stackId).then(function() {
            stack.imageIds.push(imageId);

            var progress = Math.round((stack.imageIds.length / imageIds.length) * 100);
            $(where.viewer + " " + where.viewer + "ProgressBar")[0].style.width = progress + '%';
            $(where.viewer + " " + where.viewer + "ProgressValue")[0].innerHTML = progress + '%';

            if (stack.imageIds.length === imageIds.length) {
              $(where.viewer + " " + where.viewer + "ProgressBar")[0].style.width = 0 + '%';
              $(where.viewer + " " + where.viewer + "ProgressValue")[0].innerHTML = '';
            }
          }));
        });

        Promise.all(imgPromises).then(function() {
          imageViewers.addStack(stack);
          imageViewers.setStackColor(stack.stackId, stack.color);
          imageViewers.orderStack(stack.stackId).then(function() {
            resolve(stackId);
          }).catch(function(reason) {
            reject('Could not order stack slices in ' + stackId + ' due to ' + reason);
            imageViewers.displayAlert('Failed to order stack slices in ' + stackId + ' due to ' + reason);
          });

        }).catch(function(reason){
          console.log('Not all images in ' + stackId + ' were loaded. ' + reason);
          reject('Not all images in ' + stackId + ' were loaded.');
        });
      }
    });

    return promise;
  }

  function loadAndViewStack(imageIds, where, stackId, displayStructElement, color, opacityValue, imageProcessing, detections) {

    var element;
    var frame = $(where.viewer)[0];
    element = cornerstoneLayers.addElement(frame);

    // color passed in can be a name or a rgb string
    var colorArray;
    if (color === undefined) {
      colorArray = undefined;
    } else if (color === "white" || color === "black" || color === "red" || color === "green" || color === "blue") {
      colorArray = colorNameToRGBArray(color);
    } else {
      colorArray = RGBStringToRGBArray(color);
    }
    addCustomControls(where.viewer, element, displayStructElement, stackId, colorArray, opacityValue);

    imageViewers.initializeStackElement(element);

    var enabledFrame = cornerstoneLayers.getEnabledFrame(frame);

    return imageViewers.loadAndCacheStack(imageIds, stackId, color, opacityValue, where).then(function(stackId) {
      return imageViewers.loadAndViewImage(imageViewers.stacks[stackId].imageIds[0], where, stackId, element, frame, opacityValue, imageProcessing).then(function() {
        // Calculate a wwwc for tiff or tiff16
        if (imageViewers.stacks[stackId].imageIds[0].substring(0, 4) === "tiff") {
          overlayTools.scaleViewport(element);
        } else {
          // DICOM case - hard code the window level for overlays
          if (element !== enabledFrame.elements[0]) {
            imageViewers.setWWWC(element, 1, 2998);  // window width = 1, window center = 2998 (want pixels at 3000 to map to max)
          }
        }
        restoreDetectionAppState(detections, element, enabledFrame, stackId);

        if (element === enabledFrame.elements[0]) {
          enabledFrame.synchronizer.addSource(element);
          //enabledFrame.synchronizer2.addSource(element);
          enabledFrame.synchronizer3.addSource(element);
        } else {
          enabledFrame.synchronizer.addTarget(element);
          //enabledFrame.synchronizer2.addTarget(element);
          enabledFrame.synchronizer3.addTarget(element);
        }

        return stackId;
      });
    }).catch(function(fromReject) {
      console.error('Stack ' + stackId + ' cannot be viewed. ' + fromReject);
      return Promise.reject(fromReject);
    });
  }

  function checkCache(stackId) {
    console.info("Checking cache: " + stackId);
    return new Promise(function(resolve, reject) {
      if (stackId in imageViewers.stacks) {
        console.info('Cache hit ' + stackId);
        resolve(imageViewers.stacks[stackId].imageIds);
      } else {
        console.info('Cache miss ' + stackId);
        reject(['Cache miss', stackId]);
      }
    });
  }

  function restoreDetectionAppState(detections, element, enabledFrame, stackId) {
    if (typeof detections !== 'undefined' && element === enabledFrame.elements[0]) {

      var appState = {
          imageIdToolState: {},
          elementToolState: {},
          elementViewport: {}
      };

      for (var i = 0; i < detections.length; i++) {
        var sliceIndex = detections[i].data[2];

        var keySlice = imageViewers.stacks[stackId].imageIds[sliceIndex];
        appState.imageIdToolState[keySlice] = {
          probe: {
            data: [
              {
                id: detections[i].object_name,
                visible: true,
                active:false,
                handles: {
                  end: {
                    x: detections[i].data[0],
                    y: detections[i].data[1],
                    highlight: true,
                    active: false
                  }
                },
                invalidated: true
              }
            ]
          }
        };
      }
      var keyElementId = enabledFrame.elements[0].id;
      appState.elementToolState[keyElementId] = {
        stack: {
          data: [
            {
              color: "rgb(255,255,255)",
              currentImageIdIndex: 1,
              imageIds: imageViewers.stacks[stackId].imageIds,
              opacityValue: 1,
              stackId: stackId
            }
          ]
        }
      };
      appState.elementViewport[enabledFrame.elements[0].id] = cornerstone.getViewport(enabledFrame.elements[0]);
      cornerstoneTools.appState.restore(appState);
    }
  }

  function colorNameToRGBArray(name) {
    return {
      "white": [255,255,255],
      "black": [0,0,0],
      "red": [255,0,0],
      "green": [0,128,0],
      "blue": [0,0,255]
    }[name.toLowerCase()];
  }

  function RGBStringToRGBArray(rgbString) {
    var colorStrArr = rgbString.replace(/[^\d,]/g, '').split(',');
    for(var i=0; i<colorStrArr.length; i++)
    {
      colorStrArr[i] = parseInt(colorStrArr[i]);
    }
    return colorStrArr;
  }

  // getProbes could be called multiple asynchronous times.
  function getProbes(stackId) {
    return new Promise(function(resolve, reject) {
      var probeList = [];
      var promises = [];
      $.each(imageViewers.stacks[stackId].imageIds, function(index, imageId) {
        if(cornerstoneTools.globalImageIdSpecificToolStateManager.toolState[imageId] !== undefined) {
          var x = 0;
          var y = 0;
          var z = 0;
          var imgPromise = cornerstoneLayers.loadImage(imageId);
          promises.push(imgPromise);
          imgPromise.then(function(image) {
            if (image.data !== undefined) {
              x = Math.round(cornerstoneTools.globalImageIdSpecificToolStateManager.toolState[imageId].probe.data[0].handles.end.x);
              y = Math.round(cornerstoneTools.globalImageIdSpecificToolStateManager.toolState[imageId].probe.data[0].handles.end.y);
              z = image.data.intString("x00200013");
              probeList.push([x, y, z]);
            }
          }).catch(function (error) {
            console.logError("getProbes(), error in promise");
          });
        }
      });
      /* The line below can be used to test error handling.
       * reject("deliberate error from imageViewers.getProbes()");
       * (Comment the block below if trying this.)
       */
      Promise.all(promises).then(function() {
          resolve({ 'probeList' : probeList });
      }).catch(function(error) {
          reject("getProbes(), error in promises: " + error);
      })
    });
  }

  // module/private exports
  imageViewers.loadAndCacheStack = loadAndCacheStack;
  imageViewers.loadAndViewStack = loadAndViewStack;
  imageViewers.checkCache = checkCache;
  imageViewers.getProbes = getProbes;
}($, imageViewers));
