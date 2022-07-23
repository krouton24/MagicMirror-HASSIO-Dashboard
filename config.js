/* Magic Mirror Config Sample
 *
 * By Michael Teeuw http://michaelteeuw.nl
 * MIT Licensed.
 *
 * For more information how you can configurate this file
 * See https://github.com/MichMich/MagicMirror#configuration
 *
 */

var config = {
	address: "0.0.0.0", // Address to listen on, can be:
	                      // - "localhost", "127.0.0.1", "::1" to listen on loopback interface
	                      // - another specific IPv4/6 to listen on a specific interface
	                      // - "", "0.0.0.0", "::" to listen on any interface
	                      // Default, when address config is left out, is "localhost"
	port: 8080,
	ipWhitelist: [], // Set [] to allow all IP addresses


	language: "en",
	timeFormat: 12,
	units: "metric",

	modules: [

        {
			module: 'MMM-ModuleScheduler'
		},

//BACKGROUND
{
	module: 'MMM-BackgroundSlideshow',
	position: 'top_center',
	disabled: false,
	config: {
		imagePaths: ['modules/MMM-BackgroundSlideshow/photos'],
		transitionImages: true,
                gradient: [ "rgba(0, 0, 0, 0) 0%", "rgba(0, 0, 0, 0) 40%", "rgba(0, 0, 0, 0) 80%", "rgba(0, 0, 0, 0) 100%" ],                
                transitionTimingFunction: 'cubic-bezier(0.99,-0.2,0.2,1)',                
                transitions: ['slideFromRight', 'slideFromLeft'],
                showProgressBar: false,
                slideshowSpeed: 60000,
		backgroundSize: 'contain',
		randomizeImageOrder: true
	}
},

//CLOCK
		{
			module: "clock",
			position: "top_right",
			disabled: false,
			config:	{
				showPeriod: false,
				showPeriodUpper: true,
				clockBold: false,
				displaySeconds: false,
				dateFormat: "ddd, MMM Do",
			}
		},

//SMART WEB DISPLAY
		{
			module: 'MMM-SmartWebDisplay',
			position: 'bottom_right',	
			disabled: false,
			config: {
				logDebug: false, 
				height:"800px", 
				width:"400px", 
				updateInterval: 0, //in min. Set it to 0 for no refresh
				NextURLInterval: 0, //in min, set it to 0 to not change
				displayLastUpdate: false, 
				url: ["http://10.1.1.43:8123/ha-devices/cal"], 
				scrolling: "yes",
				shutoffDelay: 1000000000000 
				}
		},
		

		{
			module: 'MMM-SmartWebDisplay',
			position: 'fullscreen_above',
			disabled: true,
			config: {
				logDebug: false, 
				height:"820px", 
				width:"950px", 
				updateInterval: 9, //in min. Set it to 0 for no refresh
				NextURLInterval: 0, //in min, set it to 0 to not change
				displayLastUpdate: false, 
				url: ["http://10.1.1.43:8123/ha-devices/cams"],
				scrolling: "yes", 
				shutoffDelay: 1000000000000  
				}
       },

	   {
		module: 'MMM-SmartWebDisplay',
		position: 'middle_center',
		disabled: false,
		config: {
			logDebug: false, 
			height:"320px", 
			width:"1850px", 
			updateInterval: 0, //in min. Set it to 0 for no refresh
			NextURLInterval: 0, //in min, set it to 0 to not change
			displayLastUpdate: false, 
			url: ["http://10.1.1.43:8123/ha-devices/solar"],
			scrolling: "no", 
			shutoffDelay: 1000000000000  
			}
   },

		{
			module: 'MMM-SmartWebDisplay',
			position: 'top_left',
			disabled: false,
			config: {
				logDebug: false, 
				height:"800px", 
				width:"800px", 
				updateInterval: 0, //in min. Set it to 0 for no refresh
				NextURLInterval: 0, //in min, set it to 0 to not change
				displayLastUpdate: false, 
				url: ["http://10.1.1.43:8123/ha-devices/weather"], 
				scrolling: "no", 
				shutoffDelay: 1000000000000  
				}

		},

        {
  		module: "MMM-HTMLSnippet",
  		position: "fullscreen_below",
		disabled: true,
  		config: {
        		html:`div id='wrapper-ELec'><span id='h2-ELec'><a id='url-ELec' href="//http://10.1.1.43:8123/ha-devices/cams">`,
        		width: "600px",
        		height: "300px",
        		backgroundColor: "#FFF",
        		updateInterval: 3600000,
      		},
  },		

		]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") {module.exports = config;}
