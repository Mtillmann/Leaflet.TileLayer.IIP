/*
# L.TileLayer.IIP adds support for IIP layers to Leaflet
# (see http://iipimage.sourceforge.net/documentation/protocol/)
#
#	Copyright:		(C) 2015 Emmanuel Bertin - IAP/CNRS/UPMC,
#                        Chiara Marmo - IDES/Paris-Sud,
#                        Ruven Pillay - C2RMF/CNRS
#
#	Last modified:		17/06/2015
*/

L.TileLayer.IIP = L.TileLayer.extend({
// Definitions for RegExp
	REG_PDEC: '(\\d+\\.\\d*)',
	REG_FLOAT: '([-+]?[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?)',

	options: {
		title: '',
		minZoom: 0,
		maxZoom: null,
		maxNativeZoom: 18,
		noWrap: true,
		contrast: 1.0,
		gamma: 1.0,
		cMap: 'grey',
		invertCMap: false,
		quality: 90,
		mix: false,
		mixingMatrix: [],
		channelLabels: [],
		minMaxValues: [],
		defaultChannel: 0
		/*
		pane: 'tilePane',
		opacity: 1,
		attribution: <String>,
		maxNativeZoom: <Number>,
		zIndex: <Number>,
		bounds: <LatLngBounds>
		unloadInvisibleTiles: L.Browser.mobile,
		updateWhenIdle: L.Browser.mobile,
		updateInterval: 150,
		tms: <Boolean>,
		zoomReverse: <Number>,
		detectRetina: <Number>,
		*/
	},

	iipdefault: {
		contrast: 1,
		gamma: 1,
		cMap: 'grey',
		invertCMap: false,
		minValue: [],
		maxValue: [],
		quality: 90
	},

	initialize: function (url, options) {
		options = L.setOptions(this, options);

		// detecting retina displays, adjusting tileSize and zoom levels
		if (options.detectRetina && L.Browser.retina && options.maxZoom > 0) {

			options.tileSize = Math.floor(options.tileSize / 2);
			options.zoomOffset++;

			options.minZoom = Math.max(0, options.minZoom);
			options.maxZoom--;
		}

		this._url = url.replace(/\&.*$/g, '');

		if (typeof options.subdomains === 'string') {
			options.subdomains = options.subdomains.split('');
		}

		this.iipTileSize = {x: 256, y: 256};
		this.iipImageSize = [];
		this.iipImageSize[0] = this.iipTileSize;
		this.iipGridSize = [];
		this.iipGridSize[0] = {x: 1, y: 1};
		this.iipBPP = 8;
		this.iipNChannel = 1;
		this.iipMinZoom = this.options.minZoom;
		this.iipMaxZoom = this.options.maxZoom;
		this.iipContrast = this.options.contrast;
		this.iipGamma = this.options.gamma;
		this.iipCMap = this.options.cMap;
		this.iipInvertCMap = this.options.invertCMap;
		this.iipMinValue = [];
		this.iipMinValue[0] = 0.0;
		this.iipMaxValue = [];
		this.iipMaxValue[0] = 255.0;
		this.iipMix = [[]];
		this.iipRGB = [];
		this.iipChannelLabels = [];
		this.iipQuality = this.options.quality;

		this._title = options.title.length > 0 ? options.title :
		                this._url.match(/^.*\/(.*)\..*$/)[1];
		this.getIIPMetaData(this._url);
		return this;
	},

	getIIPMetaData: function (url) {
		this._requestURI(url +
			'&obj=IIP,1.0&obj=max-size&obj=tile-size' +
			'&obj=resolution-number&obj=bits-per-channel' +
			'&obj=min-max-sample-values&obj=subject',
			'getting IIP metadata',
			this._parseMetadata, this);
	},

	_parseMetadata: function (layer, httpRequest) {
		if (httpRequest.readyState === 4) {
			if (httpRequest.status === 200) {
				var response = httpRequest.responseText,
				 matches = layer._readIIPKey(response, 'IIP', layer.REG_PDEC);
				if (!matches) {
					alert('Error: Unexpected response from IIP server ' +
					 layer._url.replace(/\?.*$/g, ''));
				}

				var options = layer.options,
				    iipdefault = layer.iipdefault;

				matches = layer._readIIPKey(response, 'Max-size', '(\\d+)\\s+(\\d+)');
				var maxsize = {
					x: parseInt(matches[1], 10),
					y: parseInt(matches[2], 10)
				};
				matches = layer._readIIPKey(response, 'Tile-size', '(\\d+)\\s+(\\d+)');
				layer.iipTileSize = {
					x: parseInt(matches[1], 10),
					y: parseInt(matches[2], 10)
				};

				options.tileSize = layer.iipTileSize.x;

				// Find the lowest and highest zoom levels
				matches = layer._readIIPKey(response, 'Resolution-number', '(\\d+)');
				layer.iipMaxZoom = parseInt(matches[1], 10) - 1;
				if (layer.iipMinZoom > options.minZoom) {
					options.minZoom = layer.iipMinZoom;
				}
				if (!options.maxZoom) {
					options.maxZoom = layer.iipMaxZoom + 6;
				}
				options.maxNativeZoom = layer.iipMaxZoom;

				// Set grid sizes
				for (var z = 0; z <= layer.iipMaxZoom; z++) {
					layer.iipImageSize[z] = {
						x: Math.floor(maxsize.x / Math.pow(2, layer.iipMaxZoom - z)),
						y: Math.floor(maxsize.y / Math.pow(2, layer.iipMaxZoom - z))
					};
					layer.iipGridSize[z] = {
						x: Math.ceil(layer.iipImageSize[z].x / layer.iipTileSize.x),
						y: Math.ceil(layer.iipImageSize[z].y / layer.iipTileSize.y)
					};
				}
				// (Virtual) grid sizes for extra zooming
				for (z = layer.iipMaxZoom; z <= options.maxZoom; z++) {
					layer.iipGridSize[z] = layer.iipGridSize[layer.iipMaxZoom];
				}

				// Set pixel bpp
				matches = layer._readIIPKey(response, 'Bits-per-channel', '(\\d+)');
				layer.iipBPP = parseInt(matches[1], 10);
				// Only 32bit data are likely to be linearly quantized
				if (layer.iipGamma === layer.iipdefault.gamma) {
					layer.iipGamma = layer.iipBPP >= 32 ? 2.2 : 1.0;
				}

				// Pre-computed Min and max pixel values
				matches = layer._readIIPKey(response, 'Min-Max-sample-values',
				 '\\s*(.*)');
				var str = matches[1].split(/\s+/),
				    nchannel = layer.iipNChannel = (str.length / 2),
				    mmc = 0;
				for (var c = 0; c < nchannel; c++) {
					iipdefault.minValue[c] = parseFloat(str[mmc++]);
					iipdefault.maxValue[c] = parseFloat(str[mmc++]);
				}

				// Override min and max pixel values based on user provided options
				var minmax = options.minMaxValues;
				if (minmax.length) {
					for (c = 0; c < nchannel; c++) {
						if (minmax[c] !== undefined) {
							layer.iipMinValue[c] = minmax[c][0];
							layer.iipMaxValue[c] = minmax[c][1];
						} else {
							layer.iipMinValue[c] = iipdefault.minValue[c];
							layer.iipMaxValue[c] = iipdefault.maxValue[c];
						}
					}
				} else {
					for (c = 0; c < nchannel; c++) {
						layer.iipMinValue[c] = iipdefault.minValue[c];
						layer.iipMaxValue[c] = iipdefault.maxValue[c];
					}
				}


				// Initialize mixing matrix to unity
				var m,
				    mix = layer.iipMix,
						omix = options.mixingMatrix;

				for (var col = 0; col < 3; col++) {
					mix[col] = [];
					c = nchannel;
					if (omix.length && omix[col].length) {
						while (c--) { mix[col][c] = omix[col][c]; }
					} else {
						while (c--) { mix[col][c] = 0.0; }
						mix[col][col] = 1.0;
					}
				}

				var	rgb = layer.iipRGB;

				// Initialize RGB triplet based on mixing matrix
				for (c = 0; c < nchannel; c++) {
					rgb[c] = {r: mix[0][c], g: mix[1][c], b: mix[2][c]};
				}

				// Default channel
				layer.iipChannel = options.defaultChannel;

				// Channel labels
				var inlabels = options.channelLabels,
				    ninlabel = inlabels.length,
				    labels = layer.iipChannelLabels;

				// Copy those labels that have been provided 
				for (c = 0; c < ninlabel; c++) {
					labels[c] = inlabels[c];
				}
				// Fill out labels that are not provided with a default string 
				for (c = ninlabel; c < nchannel; c++) {
					labels[c] = 'Channel #' + (c + 1).toString();
				}

				if (options.bounds) {
					options.bounds = L.latLngBounds(options.bounds);
				}
				layer.iipMetaReady = true;
				layer.fire('metaload');
			} else {
				alert('There was a problem with the IIP metadata request.');
			}
		}
	},

	_readIIPKey: function (str, keyword, regexp) {
		var reg = new RegExp(keyword + ':' + regexp);
		return reg.exec(str);
	},

	addTo: function (map) {
		if (this.iipMetaReady) {
			// IIP data are ready so we can go
			this._addToMap(map);
		}
		else {
			// Wait for metadata request to complete
			this.once('metaload', function () {
				this._addToMap(map);
			}, this);
		}
		return this;
	},

	_addToMap: function (map) {
		var center,
		    zoom,
		    newcrs = this.wcs,
				curcrs = map.options.crs,
				prevcrs = map._prevcrs;

		zoom = map.getZoom();
		if (zoom < this.iipMinZoom) {
			map.setZoom(this.iipMinZoom);
		}
		L.TileLayer.prototype.addTo.call(this, map);
	},

	_getTileSizeFac: function () {
		var	map = this._map,
			zoom = this._tileZoom,
			zoomN = this.options.maxNativeZoom;
		return (zoomN && zoom > zoomN) ?
				Math.round(map.getZoomScale(zoom) / map.getZoomScale(zoomN)) : 1;
	},

	_isValidTile: function (coords) {
		var crs = this._map.options.crs;

		if (!crs.infinite) {
			// don't load tile if it's out of bounds and not wrapped
			var bounds = this._globalTileRange;
			if ((!crs.wrapLng && (coords.x < bounds.min.x || coords.x > bounds.max.x)) ||
			    (!crs.wrapLat && (coords.y < bounds.min.y || coords.y > bounds.max.y))) { return false; }
		}

		// don't load tile if it's out of the tile grid
		var z = this._getZoomForUrl(),
		    wcoords = coords.clone();
		this._wrapCoords(wcoords);
		if (wcoords.x < 0 || wcoords.x >= this.iipGridSize[z].x ||
			wcoords.y < 0 || wcoords.y >= this.iipGridSize[z].y) {
			return false;
		}

		if (!this.options.bounds) { return true; }

		// don't load tile if it doesn't intersect the bounds in options
		var tileBounds = this._tileCoordsToBounds(coords);
		return L.latLngBounds(this.options.bounds).intersects(tileBounds);
	},

	getTileUrl: function (coords) {
		var str = this._url,
				z = this._getZoomForUrl();
		if (this.iipCMap !== this.iipdefault.cMap) {
			str += '&CMP=' + this.iipCMap;
		}
		if (this.iipInvertCMap !== this.iipdefault.invertCMap) {
			str += '&INV';
		}
		if (this.iipContrast !== this.iipdefault.contrast) {
			str += '&CNT=' + this.iipContrast.toString();
		}
		if (this.iipGamma !== this.iipdefault.gamma) {
			str += '&GAM=' + (1.0 / this.iipGamma).toFixed(4);
		}
		for (var c = 0; c < this.iipNChannel; c++) {
			if (this.iipMinValue[c] !== this.iipdefault.minValue[c] ||
			   this.iipMaxValue[c] !== this.iipdefault.maxValue[c]) {
				str += '&MINMAX=' + (c + 1).toString() + ':' +
				   this.iipMinValue[c].toString() + ',' + this.iipMaxValue[c].toString();
			}
		}
		if (this.options.mix === true) {
			var nchannel = this.iipNChannel,
			    mix = this.iipMix,
			    m, n;
			str += '&CTW=';
			for (n = 0; n < 3; n++) {
				if (mix[n]) {
					if (n) { str += ';'; }
					str += mix[n][0].toString();
					for (m = 1; m < nchannel; m++) {
						if (mix[n][m] !== undefined) {
							str += ',' + mix[n][m].toString();
						}
					}
				}
			}
			str += '';
		}
		if (this.iipQuality !== this.iipdefault.quality) {
			str += '&QLT=' + this.iipQuality.toString();
		}
		return str + '&JTL=' + z.toString() + ',' +
		 (coords.x + this.iipGridSize[z].x * coords.y).toString();
	},

	_initTile: function (tile) {
		L.DomUtil.addClass(tile, 'leaflet-tile');

		// Force pixels to be visible at high zoom factos whenever possible
		if (this._getTileSizeFac() > 1) {
			if (L.Browser.ie) {
				tile.style.msInterpolationMode = 'nearest-neighbor';
			} else if (L.Browser.chrome) {
				tile.style.imageRendering = 'pixelated';
			} else if (L.Browser.gecko) {
				tile.style.imageRendering = '-moz-crisp-edges';
			} else {
				tile.style.imageRendering = '-webkit-optimize-contrast';
			}
			tile.style.width = this._tileSize + 'px';
			tile.style.height = this._tileSize + 'px';
		}

		tile.onselectstart = L.Util.falseFn;
		tile.onmousemove = L.Util.falseFn;

		// update opacity on tiles in IE7-8 because of filter inheritance problems
		if (L.Browser.ielt9 && this.options.opacity < 1) {
			L.DomUtil.setOpacity(tile, this.options.opacity);
		}

		// without this hack, tiles disappear after zoom on Chrome for Android
		// https://github.com/Leaflet/Leaflet/issues/2078
		if (L.Browser.android && !L.Browser.android23) {
			tile.style.WebkitBackfaceVisibility = 'hidden';
		}
	},

// Ajax call to server
	_requestURI: function (uri, purpose, action, context) {
		var	httpRequest;

		if (window.XMLHttpRequest) { // Mozilla, Safari, ...
			httpRequest = new XMLHttpRequest();
		} else if (window.ActiveXObject) { // IE
			try {
				httpRequest = new ActiveXObject('Msxml2.XMLHTTP');
			}
			catch (e) {
				try {
					httpRequest = new ActiveXObject('Microsoft.XMLHTTP');
				}
				catch (e) {}
			}
		}
		if (!httpRequest) {
			alert('Giving up: Cannot create an XMLHTTP instance for ' + purpose);
			return false;
		}
		httpRequest.open('GET', uri);
		httpRequest.onreadystatechange = function () {
			action(context, httpRequest);
		};
		httpRequest.send();
	}

});

L.tileLayer.iip = function (url, options) {
	return new L.TileLayer.IIP(url, options);
};
