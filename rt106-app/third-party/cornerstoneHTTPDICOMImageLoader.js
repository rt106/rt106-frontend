// This is a hack on top of the wado example
//

// make this module work with RequireJS or as a browser global
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define(['dicomParser', 'cornerstone'], factory);
  } else {
    // Browser globals
    root.cornerstoneHTTPDICOMImageLoader = factory(root.dicomParser);
  }
}(this, function(dicomParser) {
  /**
   */
  var cornerstoneHTTPDICOMImageLoader = (function(cornerstoneHTTPDICOMImageLoader) {

    "use strict";

    if (cornerstoneHTTPDICOMImageLoader === undefined) {
      cornerstoneHTTPDICOMImageLoader = {};
    }


    function configure(options) {
      if (cornerstoneHTTPDICOMImageLoader.internal === undefined) {
        cornerstoneHTTPDICOMImageLoader.internal = {};
      }

      cornerstoneHTTPDICOMImageLoader.internal.options = options;
    }
    configure({
      beforeSend : function(xhr) {}
    });

    // module exports
    cornerstoneHTTPDICOMImageLoader.configure = configure;

    return cornerstoneHTTPDICOMImageLoader;
  }(cornerstoneHTTPDICOMImageLoader));

  var cornerstoneHTTPDICOMImageLoader = (function($, cornerstone, cornerstoneHTTPDICOMImageLoader) {

    "use strict";

    if (cornerstoneHTTPDICOMImageLoader === undefined) {
      cornerstoneHTTPDICOMImageLoader = {};
    }

    //var dicomParser = require('dicomParser');

    function isColorImage(photoMetricInterpretation) {
      if (photoMetricInterpretation === "RGB" ||
        photoMetricInterpretation === "PALETTE COLOR" ||
        photoMetricInterpretation === "YBR_FULL" ||
        photoMetricInterpretation === "YBR_FULL_422" ||
        photoMetricInterpretation === "YBR_PARTIAL_422" ||
        photoMetricInterpretation === "YBR_PARTIAL_420" ||
        photoMetricInterpretation === "YBR_RCT") {
        return true;
      } else {
        return false;
      }
    }

    function createImageObject(dataSet, imageId, frame) {
      if (frame === undefined) {
        frame = 0;
      }

      // make the image based on whether it is color or not
      var photometricInterpretation = dataSet.string('x00280004');
      var isColor = isColorImage(photometricInterpretation);
      if (isColor === false) {
        return cornerstoneHTTPDICOMImageLoader.makeGrayscaleImage(imageId, dataSet, dataSet.byteArray, photometricInterpretation, frame);
      } else {
        return cornerstoneHTTPDICOMImageLoader.makeColorImage(imageId, dataSet, dataSet.byteArray, photometricInterpretation, frame);
      }
    }

    var multiFrameCacheHack = {};

    // Loads an image given an imageId
    // wado url example:
    // http://localhost:3333/wado?requestType=WADO&studyUID=1.3.6.1.4.1.25403.166563008443.5076.20120418075541.1&seriesUID=1.3.6.1.4.1.25403.166563008443.5076.20120418075541.2&objectUID=1.3.6.1.4.1.25403.166563008443.5076.20120418075557.1&contentType=application%2Fdicom&transferSyntax=1.2.840.10008.1.2.1
    // NOTE: supposedly the instance will be returned in Explicit Little Endian transfer syntax if you don't
    // specify a transferSyntax but Osirix doesn't do this and seems to return it with the transfer syntax it is
    // stored as.
    function loadImage(imageId) {
      // create a deferred object
      // TODO: Consider not using jquery for deferred - maybe cujo's when library
      var deferred = $.Deferred();

      // build a url by parsing out the url scheme and frame index from the imageId
      var url = imageId;
      if (false) {
        url = url.substring(9);
        var frameIndex = url.indexOf('frame=');
        var frame;
        if (frameIndex !== -1) {
          var frameStr = url.substr(frameIndex + 6);
          frame = parseInt(frameStr);
          url = url.substr(0, frameIndex - 1);
        }
      }

      // if multiframe and cached, use the cached data set to extract the frame
      if (frame !== undefined &&
        multiFrameCacheHack.hasOwnProperty(url)) {
        var dataSet = multiFrameCacheHack[url];
        var imagePromise = createImageObject(dataSet, imageId, frame);
        imagePromise.then(function(image) {
          deferred.resolve(image);
        }, function() {
          deferred.reject();
        });
        return deferred;
      }

      // Make the request for the DICOM data
      // TODO: consider using cujo's REST library here?
      var oReq = new XMLHttpRequest();
      oReq.open("get", url, true);
      oReq.responseType = "arraybuffer";

      cornerstoneHTTPDICOMImageLoader.internal.options.beforeSend(oReq);

      //oReq.setRequestHeader("Accept", "multipart/related; type=application/dicom");
      oReq.setRequestHeader("Accept", "application/octet-stream");

      oReq.onreadystatechange = function(oEvent) {
        // TODO: consider sending out progress messages here as we receive the pixel data
        if (oReq.readyState === 4) {
          if (oReq.status === 200) {
            // request succeeded, create an image object and resolve the deferred

            // Parse the DICOM File
            var dicomPart10AsArrayBuffer = oReq.response;
            var byteArray = new Uint8Array(dicomPart10AsArrayBuffer);
            var dataSet = dicomParser.parseDicom(byteArray);

            // if multiframe, cache the parsed data set to speed up subsequent
            // requests for the other frames
            if (frame !== undefined) {
              multiFrameCacheHack[url] = dataSet;
            }

            var imagePromise = createImageObject(dataSet, imageId, frame);
            imagePromise.then(function(image) {
              deferred.resolve(image);
            }, function() {
              deferred.reject();
            });
          }
          // TODO: Check for errors and reject the deferred if they happened
          else {
            // TODO: add some error handling here
            // request failed, reject the deferred
            deferred.reject();
          }
        }
      };
      oReq.onprogress = function(oProgress) {
        // console.log('progress:',oProgress)

        if (oProgress.lengthComputable) { //evt.loaded the bytes browser receive
          //evt.total the total bytes seted by the header
          //
          var loaded = oProgress.loaded;
          var total = oProgress.total;
          var percentComplete = Math.round((loaded / total) * 100);

          $(cornerstone).trigger('CornerstoneImageLoadProgress', {
            imageId: imageId,
            loaded: loaded,
            total: total,
            percentComplete: percentComplete
          });
        }
      };

      oReq.send();

      return deferred;
    }

    // steam the http and https prefixes so we can use wado URL's directly
    cornerstone.registerImageLoader('http', loadImage);
    cornerstone.registerImageLoader('https', loadImage);

    return cornerstoneHTTPDICOMImageLoader;
  }($, cornerstone, cornerstoneHTTPDICOMImageLoader));
  /**
   */
  var cornerstoneHTTPDICOMImageLoader = (function(cornerstoneHTTPDICOMImageLoader) {

    "use strict";

    if (cornerstoneHTTPDICOMImageLoader === undefined) {
      cornerstoneHTTPDICOMImageLoader = {};
    }

    function decodeRGB(rgbBuffer, rgbaBuffer) {
      if (rgbBuffer === undefined) {
        throw "decodeRGB: rgbBuffer must not be undefined";
      }
      if (rgbBuffer.length % 3 !== 0) {
        throw "decodeRGB: rgbBuffer length must be divisble by 3";
      }

      var numPixels = rgbBuffer.length / 3;
      var rgbIndex = 0;
      var rgbaIndex = 0;
      for (var i = 0; i < numPixels; i++) {
        rgbaBuffer[rgbaIndex++] = rgbBuffer[rgbIndex++]; // red
        rgbaBuffer[rgbaIndex++] = rgbBuffer[rgbIndex++]; // green
        rgbaBuffer[rgbaIndex++] = rgbBuffer[rgbIndex++]; // blue
        rgbaBuffer[rgbaIndex++] = 255; //alpha
      }

    }

    // module exports
    cornerstoneHTTPDICOMImageLoader.decodeRGB = decodeRGB;

    return cornerstoneHTTPDICOMImageLoader;
  }(cornerstoneHTTPDICOMImageLoader));
  /**
   */
  var cornerstoneHTTPDICOMImageLoader = (function(cornerstoneHTTPDICOMImageLoader) {

    "use strict";

    if (cornerstoneHTTPDICOMImageLoader === undefined) {
      cornerstoneHTTPDICOMImageLoader = {};
    }

    function decodeYBRFull(ybrBuffer, rgbaBuffer) {
      if (ybrBuffer === undefined) {
        throw "decodeRGB: ybrBuffer must not be undefined";
      }
      if (ybrBuffer.length % 3 !== 0) {
        throw "decodeRGB: ybrBuffer length must be divisble by 3";
      }

      var numPixels = ybrBuffer.length / 3;
      var ybrIndex = 0;
      var rgbaIndex = 0;
      for (var i = 0; i < numPixels; i++) {
        var y = ybrBuffer[ybrIndex++];
        var cb = ybrBuffer[ybrIndex++];
        var cr = ybrBuffer[ybrIndex++];
        rgbaBuffer[rgbaIndex++] = y + 1.40200 * (cr - 128); // red
        rgbaBuffer[rgbaIndex++] = y - 0.34414 * (cb - 128) - 0.71414 * (cr - 128); // green
        rgbaBuffer[rgbaIndex++] = y + 1.77200 * (cb - 128); // blue
        rgbaBuffer[rgbaIndex++] = 255; //alpha
      }

    }

    // module exports
    cornerstoneHTTPDICOMImageLoader.decodeYBRFull = decodeYBRFull;

    return cornerstoneHTTPDICOMImageLoader;
  }(cornerstoneHTTPDICOMImageLoader));
  var cornerstoneHTTPDICOMImageLoader = (function(cornerstoneHTTPDICOMImageLoader) {

    "use strict";

    if (cornerstoneHTTPDICOMImageLoader === undefined) {
      cornerstoneHTTPDICOMImageLoader = {};
    }

    function getPixelSpacing(dataSet) {
      // NOTE - these are not required for all SOP Classes
      // so we return them as undefined.  We also do not
      // deal with the complexity associated with projection
      // radiographs here and leave that to a higher layer
      var pixelSpacing = dataSet.string('x00280030');
      if (pixelSpacing && pixelSpacing.length > 0) {
        var split = pixelSpacing.split('\\');
        return {
          row: parseFloat(split[0]),
          column: parseFloat(split[1])
        };
      } else {
        return {
          row: undefined,
          column: undefined
        };
      }
    }
    // module exports
    cornerstoneHTTPDICOMImageLoader.getPixelSpacing = getPixelSpacing;

    return cornerstoneHTTPDICOMImageLoader;
  }(cornerstoneHTTPDICOMImageLoader));
  var cornerstoneHTTPDICOMImageLoader = (function(cornerstoneHTTPDICOMImageLoader) {

    "use strict";

    if (cornerstoneHTTPDICOMImageLoader === undefined) {
      cornerstoneHTTPDICOMImageLoader = {};
    }

    function getRescaleSlopeAndIntercept(dataSet) {
      // NOTE - we default these to an identity transform since modality LUT
      // module is not required for all SOP Classes
      var result = {
        intercept: 0.0,
        slope: 1.0
      };

      //var rescaleIntercept  = dicomElements.x00281052;
      //var rescaleSlope  = dicomElements.x00281053;
      var rescaleIntercept = dataSet.floatString('x00281052');
      var rescaleSlope = dataSet.floatString('x00281053');

      if (rescaleIntercept) {
        result.intercept = rescaleIntercept;
      }
      if (rescaleSlope) {
        result.slope = rescaleSlope;
      }
      return result;
    }

    // module exports
    cornerstoneHTTPDICOMImageLoader.getRescaleSlopeAndIntercept = getRescaleSlopeAndIntercept;

    return cornerstoneHTTPDICOMImageLoader;
  }(cornerstoneHTTPDICOMImageLoader));
  var cornerstoneHTTPDICOMImageLoader = (function(cornerstoneHTTPDICOMImageLoader) {

    "use strict";

    if (cornerstoneHTTPDICOMImageLoader === undefined) {
      cornerstoneHTTPDICOMImageLoader = {};
    }


    function getWindowWidthAndCenter(dataSet) {
      // NOTE - Default these to undefined since they may not be present as
      // they are not present or required for all sop classes.  We leave it up
      // to a higher layer to determine reasonable default values for these
      // if they are not provided.  We also use the first ww/wc values if
      // there are multiple and again leave it up the higher levels to deal with
      // this
      var result = {
        windowCenter: undefined,
        windowWidth: undefined
      };

      var windowCenter = dataSet.floatString('x00281050');
      var windowWidth = dataSet.floatString('x00281051');

      if (windowCenter) {
        result.windowCenter = windowCenter;
      }
      if (windowWidth) {
        result.windowWidth = windowWidth;
      }
      return result;
    }

    // module exports
    cornerstoneHTTPDICOMImageLoader.getWindowWidthAndCenter = getWindowWidthAndCenter;

    return cornerstoneHTTPDICOMImageLoader;
  }(cornerstoneHTTPDICOMImageLoader));
  var cornerstoneHTTPDICOMImageLoader = (function($, cornerstone, cornerstoneHTTPDICOMImageLoader) {

    "use strict";

    if (cornerstoneHTTPDICOMImageLoader === undefined) {
      cornerstoneHTTPDICOMImageLoader = {};
    }

    var canvas = document.createElement('canvas');
    var lastImageIdDrawn = "";

    function arrayBufferToString(buffer) {
      return binaryToString(String.fromCharCode.apply(null, Array.prototype.slice.apply(new Uint8Array(buffer))));
    }

    function binaryToString(binary) {
      var error;

      try {
        return decodeURIComponent(escape(binary));
      } catch (_error) {
        error = _error;
        if (error instanceof URIError) {
          return binary;
        } else {
          throw error;
        }
      }
    }

    function extractStoredPixels(dataSet, byteArray, photometricInterpretation, width, height, frame) {
      canvas.height = height;
      canvas.width = width;

      var pixelDataElement = dataSet.elements.x7fe00010;
      var pixelDataOffset = pixelDataElement.dataOffset;
      var transferSyntax = dataSet.string('x00020010');

      var frameSize = width * height * 3;
      var frameOffset = pixelDataOffset + frame * frameSize;
      var encodedPixelData; // = new Uint8Array(byteArray.buffer, frameOffset);
      var context = canvas.getContext('2d');
      var imageData = context.createImageData(width, height);

      var deferred = $.Deferred();

      if (photometricInterpretation === "RGB") {
        encodedPixelData = new Uint8Array(byteArray.buffer, frameOffset, frameSize);
        cornerstoneHTTPDICOMImageLoader.decodeRGB(encodedPixelData, imageData.data);
        deferred.resolve(imageData);
        return deferred;
      } else if (photometricInterpretation === "YBR_FULL") {
        encodedPixelData = new Uint8Array(byteArray.buffer, frameOffset, frameSize);
        cornerstoneHTTPDICOMImageLoader.decodeYBRFull(encodedPixelData, imageData.data);
        deferred.resolve(imageData);
        return deferred;
      } else if (photometricInterpretation === "YBR_FULL_422" &&
        transferSyntax === "1.2.840.10008.1.2.4.50") {
        encodedPixelData = dicomParser.readEncapsulatedPixelData(dataSet, frame);
        // need to read the encapsulated stream here i think
        var imgBlob = new Blob([encodedPixelData], {
          type: "image/jpeg"
        });
        var r = new FileReader();
        if (r.readAsBinaryString === undefined) {
          r.readAsArrayBuffer(imgBlob);
        } else {
          r.readAsBinaryString(imgBlob); // doesn't work on IE11
        }
        r.onload = function() {
          var img = new Image();
          img.onload = function() {
            context.drawImage(this, 0, 0);
            imageData = context.getImageData(0, 0, width, height);
            deferred.resolve(imageData);
          };
          img.onerror = function(z) {
            deferred.reject();
          };
          if (r.readAsBinaryString === undefined) {
            img.src = "data:image/jpeg;base64," + window.btoa(arrayBufferToString(r.result));
          } else {
            img.src = "data:image/jpeg;base64," + window.btoa(r.result); // doesn't work on IE11
          }

        };
        return deferred;
      }
      throw "no codec for " + photometricInterpretation;
    }

    function makeColorImage(imageId, dataSet, byteArray, photometricInterpretation, frame) {

      // extract the DICOM attributes we need
      var pixelSpacing = cornerstoneHTTPDICOMImageLoader.getPixelSpacing(dataSet);
      var rows = dataSet.uint16('x00280010');
      var columns = dataSet.uint16('x00280011');
      var rescaleSlopeAndIntercept = cornerstoneHTTPDICOMImageLoader.getRescaleSlopeAndIntercept(dataSet);
      var bytesPerPixel = 4;
      var numPixels = rows * columns;
      var sizeInBytes = numPixels * bytesPerPixel;
      var windowWidthAndCenter = cornerstoneHTTPDICOMImageLoader.getWindowWidthAndCenter(dataSet);

      var deferred = $.Deferred();

      // Decompress and decode the pixel data for this image
      var imageDataPromise = extractStoredPixels(dataSet, byteArray, photometricInterpretation, columns, rows, frame);
      imageDataPromise.then(function(imageData) {
        function getPixelData() {
          return imageData.data;
        }

        function getImageData() {
          return imageData;
        }

        function getCanvas() {
          if (lastImageIdDrawn === imageId) {
            return canvas;
          }

          canvas.height = rows;
          canvas.width = columns;
          var context = canvas.getContext('2d');
          context.putImageData(imageData, 0, 0);
          lastImageIdDrawn = imageId;
          return canvas;
        }

        // Extract the various attributes we need
        var image = {
          imageId: imageId,
          minPixelValue: 0,
          maxPixelValue: 255,
          slope: rescaleSlopeAndIntercept.slope,
          intercept: rescaleSlopeAndIntercept.intercept,
          windowCenter: windowWidthAndCenter.windowCenter,
          windowWidth: windowWidthAndCenter.windowWidth,
          render: cornerstone.renderColorImage,
          getPixelData: getPixelData,
          getImageData: getImageData,
          getCanvas: getCanvas,
          rows: rows,
          columns: columns,
          height: rows,
          width: columns,
          color: true,
          columnPixelSpacing: pixelSpacing.column,
          rowPixelSpacing: pixelSpacing.row,
          data: dataSet,
          invert: false,
          sizeInBytes: sizeInBytes
        };

        if (image.windowCenter === undefined) {
          image.windowWidth = 255;
          image.windowCenter = 128;
        }
        deferred.resolve(image);
      }, function() {
        deferred.reject();
      });

      return deferred;
    }

    // module exports
    cornerstoneHTTPDICOMImageLoader.makeColorImage = makeColorImage;

    return cornerstoneHTTPDICOMImageLoader;
  }($, cornerstone, cornerstoneHTTPDICOMImageLoader));
  var cornerstoneHTTPDICOMImageLoader = (function($, cornerstone, cornerstoneHTTPDICOMImageLoader) {

    "use strict";

    if (cornerstoneHTTPDICOMImageLoader === undefined) {
      cornerstoneHTTPDICOMImageLoader = {};
    }

    function getPixelFormat(dataSet) {
      // NOTE - this should work for color images too - need to test
      var pixelRepresentation = dataSet.uint16('x00280103');
      var bitsAllocated = dataSet.uint16('x00280100');
      var photometricInterpretation = dataSet.string('x00280004');
      if (pixelRepresentation === 0 && bitsAllocated === 8) {
        return 1; // unsigned 8 bit
      } else if (pixelRepresentation === 0 && bitsAllocated === 16) {
        return 2; // unsigned 16 bit
      } else if (pixelRepresentation === 1 && bitsAllocated === 16) {
        return 3; // signed 16 bit data
      }
    }

    function extractStoredPixels(dataSet, byteArray, width, height, frame) {
      var pixelFormat = getPixelFormat(dataSet);
      var pixelDataElement = dataSet.elements.x7fe00010;
      var pixelDataOffset = pixelDataElement.dataOffset;
      var numPixels = width * height;

      // Note - we may want to sanity check the rows * columns * bitsAllocated * samplesPerPixel against the buffer size

      var frameOffset = 0;
      if (pixelFormat === 1) {
        frameOffset = pixelDataOffset + frame * numPixels;
        return new Uint8Array(byteArray.buffer, frameOffset, numPixels);
      } else if (pixelFormat === 2) {
        frameOffset = pixelDataOffset + frame * numPixels * 2;
        return new Uint16Array(byteArray.buffer, frameOffset, numPixels);
      } else if (pixelFormat === 3) {
        frameOffset = pixelDataOffset + frame * numPixels * 2;
        return new Int16Array(byteArray.buffer, frameOffset, numPixels);
      }
    }

    function getBytesPerPixel(dataSet) {
      var pixelFormat = getPixelFormat(dataSet);
      if (pixelFormat === 1) {
        return 1;
      } else if (pixelFormat === 2 || pixelFormat === 3) {
        return 2;
      }
      throw "unknown pixel format";
    }

    function getMinMax(storedPixelData) {
      // we always calculate the min max values since they are not always
      // present in DICOM and we don't want to trust them anyway as cornerstone
      // depends on us providing reliable values for these
      var min = 65535;
      var max = -32768;
      var numPixels = storedPixelData.length;
      var pixelData = storedPixelData;
      for (var index = 0; index < numPixels; index++) {
        var spv = pixelData[index];
        // TODO: test to see if it is faster to use conditional here rather than calling min/max functions
        min = Math.min(min, spv);
        max = Math.max(max, spv);
      }

      return {
        min: min,
        max: max
      };
    }


    function makeGrayscaleImage(imageId, dataSet, byteArray, photometricInterpretation, frame) {

      // extract the DICOM attributes we need
      var pixelSpacing = cornerstoneHTTPDICOMImageLoader.getPixelSpacing(dataSet);
      var rows = dataSet.uint16('x00280010');
      var columns = dataSet.uint16('x00280011');
      var rescaleSlopeAndIntercept = cornerstoneHTTPDICOMImageLoader.getRescaleSlopeAndIntercept(dataSet);
      var bytesPerPixel = getBytesPerPixel(dataSet);
      var numPixels = rows * columns;
      var sizeInBytes = numPixels * bytesPerPixel;
      var invert = (photometricInterpretation === "MONOCHROME1");
      var windowWidthAndCenter = cornerstoneHTTPDICOMImageLoader.getWindowWidthAndCenter(dataSet);

      // Decompress and decode the pixel data for this image
      var storedPixelData = extractStoredPixels(dataSet, byteArray, columns, rows, frame);
      var minMax = getMinMax(storedPixelData);

      function getPixelData() {
        return storedPixelData;
      }

      // Extract the various attributes we need
      var image = {
        imageId: imageId,
        minPixelValue: minMax.min,
        maxPixelValue: minMax.max,
        slope: rescaleSlopeAndIntercept.slope,
        intercept: rescaleSlopeAndIntercept.intercept,
        windowCenter: windowWidthAndCenter.windowCenter,
        windowWidth: windowWidthAndCenter.windowWidth,
        render: cornerstone.renderGrayscaleImage,
        getPixelData: getPixelData,
        rows: rows,
        columns: columns,
        height: rows,
        width: columns,
        color: false,
        columnPixelSpacing: pixelSpacing.column,
        rowPixelSpacing: pixelSpacing.row,
        data: dataSet,
        invert: invert,
        sizeInBytes: sizeInBytes
      };


      // TODO: deal with pixel padding and all of the various issues by setting it to min pixel value (or lower)
      // TODO: Mask out overlays embedded in pixel data above high bit

      if (image.windowCenter === undefined) {
        var maxVoi = image.maxPixelValue * image.slope + image.intercept;
        var minVoi = image.minPixelValue * image.slope + image.intercept;
        image.windowWidth = maxVoi - minVoi;
        image.windowCenter = (maxVoi + minVoi) / 2;
      }

      var deferred = $.Deferred();
      deferred.resolve(image);
      return deferred;
    }

    // module exports
    cornerstoneHTTPDICOMImageLoader.makeGrayscaleImage = makeGrayscaleImage;

    return cornerstoneHTTPDICOMImageLoader;
  }($, cornerstone, cornerstoneHTTPDICOMImageLoader));


  return cornerstoneHTTPDICOMImageLoader;
}));
