"use strict"

/*
    App 
    
    A singleton that represents the application. For your application, 
    create a subclass called App and implement a custom setup method.

    Handles starting up NodeStore.

*/

window.App = BMNode.extend().newSlots({
    type: "App",
    name: "App",
    isDebugging: true,
    version: [0, 0],
    nodeStoreDidOpenObs: null,
    appDidInitNote: null,
}).setSlots({

    shared: function() {   
        return this.sharedInstanceForClass(App)
    },

    init: function () {
        BMNode.init.apply(this)
        this.setAppDidInitNote(window.NotificationCenter.shared().newNote().setSender(this).setName("appDidInit"))
        this.setNodeStoreDidOpenObs(window.NotificationCenter.shared().newObservation())
        this.nodeStoreDidOpenObs().setName("nodeStoreDidOpen").setObserver(this).setTarget(NodeStore.shared())
    },

    // run and setup sequence in order of which methods are called
    // 1. setup NodeStore

    run: function() {

        if (!this.isBrowserCompatible()) {
            console.log("App showBrowserCompatibilityPanel")
            window.LoadProgressBar.setError("Sorry, this app only works on<br>Chrome, FireFox, and Brave browsers.")
            //this.showBrowserCompatibilityPanel()
            return this
        }

        this.nodeStoreDidOpenObs().watch()
        NodeStore.shared().asyncOpen() 
    },

    showBrowserCompatibilityPanel: function() {
        console.log("showing panel")
        var panel = window.PanelView.clone()
        this.rootView().addSubview(panel)
        panel.setTitle("Sorry, this app only works on<br>Chrome, FireFox, and Brave browsers.")
        panel.orderFront()
        panel.setZIndex(100)
        console.log("showed panel")
    },

    // 2. setup 

    nodeStoreDidOpen: function() {
        this.nodeStoreDidOpenObs().stopWatching()
        this.setup()
    },

    setup: function() {
        return this        
    },

    appDidInit: function() {
        this.appDidInitNote().post()

        if (this.runTests) {
		    this.runTests()
        }

        //this.registerServiceWorker() // not working yet
    },
	
    rootView: function() {
        return DivView.rootView()
        //return  WebBrowserWindow.shared().documentBody()
    },

    mainWindow: function () {
        return Window
    },

    setName: function(aString) {
        this._name = aString
        this.setTitle(aString)
        WebBrowserWindow.shared().setTitle(aString)
        return this
    },
    
    // --- version ---

    versionsString: function() {
        return this.version().join(".")
    },

    showVersion: function() {
        console.log("Application '" + this.name() + "' version " + this.versionsString())
    },

    // --- server worker ---

    registerServiceWorker: function() {
        // doesn't work
        // "src/ServiceWorker.js"
        // "/src/ServiceWorker.js"
        // "../ServiceWorker.js"
        var path = "ServiceWorker.js"
        console.log("registering service worker '" + path + "'")
        var promise = navigator.serviceWorker.register(path); //{ scope: ""../"}

        promise.then(function (registration) {
            console.log("Service worker successfully registered on scope", registration.scope);
        }).catch(function (error) {
            console.log("Service worker failed to register:\n",
                "  typeof(error): ", typeof(error), "\n", 
                "  message:", error.message, "\n",
                "  fileName:", error.fileName, "\n",
                "  lineNumber:", error.lineNumber,  "\n",
                "  stack:", error.stack,  "\n"
                //"  JSON.stringify(error):", JSON.stringify(error),  "\n",
                //"  toString:", error.toString()
            );
        });
    }

})

