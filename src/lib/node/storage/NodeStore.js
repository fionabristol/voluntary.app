"use strict"

/*
    NodeStore: 

		An object store for BMStorableNode objects, that supports 
		- read reference cache of "activeObjects" so re-loading an object will reference the same instance
		- a write reference cache of "dirtyObjects"
		- automatic tracking of dirty objects (objects whose state needs to be persisted)
		- group transactional writes of dirty objects ( nodeStore.storeDirtyObjects() )
		- on disk garbage collection of persisted objects ( nodeStore.collect() )	
		- supports circular references and properly collecting them
	
    
    Garbage collection:
    
		The collector can have multiple roots. Any object stored with a pid (persistent Id) that begins
		with an underscore will be treated as a root object and always marked when collecting garbage.
		
        Example:
 
				var people = NodeStore.rootInstanceWithPidForProto("_people", PeopleNode) 
		
		This instantiates the object if it's not persisted, loads it if it is, and returns any already 
		unpersisted instance if there is one.

	Active objects:
                
        Whenever a BNStorableNode instance is created, it's init method tells the store of 
        it's existence ( addActiveObject(aNode) ) and marks itself as dirty if it's not being unserialized.
        
        All dirty objects are transactionally persisted on the next event loop. 
		This avoids multiple writes for multiple changes within a given loop.
    
    Persistent ids:
    
        each object is assigned a _pid property when persisted 
        _pid is a unique (persistent id) number (in string form) for the object
    
        If a serialized object record dictionary value points to string or number, it's value is stored in json.
        Otherwise, it's value is stored as a pid reference in a dictionary 
        like { _pid: pidNum }. 
    
    Writing and reading objects:
    
        BMStorableNode defines nodeDict() and setNodeDict(aDict) methods
        a nodeDict is JSON dict and contains a type slot which contains the object type name
        such that:
    
            window[typeName].clone().setNodeDict(nodeDict).didLoadFromStore()
        
        can be used to unserialize the object. Object's are responsible for unserializing 
        the nodeDict. The NodeStore.refForObject(obj) and NodeStore.objectForRef(refDict) can be used
        to contruct refs and derefence them as needed.

        Example use:
    
                var store = NodeStore.clone().setFolderName("store")
            
            // need to define a root
            
                var root = BMStorableNode.clone()
                store.setRootObject(root)
                store.load()
            
            // when you modify any BMStorableNode instance's subnodes or stored data slots, 
            // or call scheduleSyncToStore() on it, it will be marked as needing to be persisted in the
            // next event loop
            
                var test = BMNode.clone()
                root.this.addSubnode(test) // this marks root as dirty
                test.this.addSubnode(foo) // this marks test as dirty
                        
            // for singleton objects, set their pid to a unique name, e.g.
            
                servers.setPid("_servers")
            
            // when ready to store
            
                store.store()
            
            
    
    Garbage collection
    
        Periodically (e.g. when opening/closing an app) you'll want to delete any unreferenced
        object records to make sure they don't use up too much space. To do this call:
    
            pdb.collect()
 
*/

window.NodeStore = ideal.Proto.extend().newSlots({
    type: "NodeStore",
    folderName: "NodeStore",
    folder: null,

    dirtyObjects: null,
    activeObjectsDict: null,

    sdb: null,
    isReadOnly: false,

    debug: false,

    nodeStoreDidOpenNote: null,
}).setSlots({
    init: function () {
        this.setDirtyObjects({})
        this.setActiveObjectsDict({})
        this.setSdb(window.SyncDB.clone())
        this.setNodeStoreDidOpenNote(window.NotificationCenter.shared().newNote().setSender(this).setName("nodeStoreDidOpen"))
        //this.asyncOpen()
    },

    descriptionForByteCount: function (b) {
        return ByteFormatter.clone().setValue(b).formattedValue()
    },

    shortStatsString: function () {
        if (!this.isOpen()) {
            return "closed"
        }
        var b = this.sdb().totalBytes()
        return this.sdb().size() + " objects, " + ByteFormatter.clone().setValue(b).formattedValue()
    },

    isOpen: function () {
        return this.sdb().isOpen()
    },

    asyncOpen: function (callback) {
        this.assertHasUniqueId()

        if (this.isOpen()) {
            throw new Error(this.typeId() + ".asyncOpen() already open")
        }
        this.sdb().asyncOpen(() => {
            this.didOpen()
            //this.clear()
            if (callback) {
                callback()
            }
            this._nodeStoreDidOpenNote.post()
        })
    },

    didOpen: function () {
        this.collect()
    },

    shared: function () {
        if (!this._shared) {
            this._shared = this.clone()
            this._shared.assertHasUniqueId()
            //this._shared.setFolder(App.shared().storageFolder().folderNamed(this.folderName())) 
        }
        return this._shared
    },

    rootInstanceWithPidForProto: function (pid, proto) {
        if (this.hasObjectForPid(pid)) {
            return this.objectForPid(pid)
        }

        return proto.clone().setPid(pid)
    },

    // ----------------------------------------------------
    // dirty objects
    // ----------------------------------------------------

    addDirtyObject: function (obj) {
        // dirty objects list won't be huge, so a list is ok

        // don't use pid for these keys so we can
        // use pid to see if the obj gets referrenced when walked from a stored node

        var objId = obj.uniqueId()
        if (!(objId in this._dirtyObjects)) {

            /*
            if (obj.hasPid()) {
                console.warn("addDirtyObject: " + obj.pid())
            } else {
                console.warn("addDirtyObject: " + obj.typeId())
            }
            */


            //console.log("addDirtyObject(" + obj.pid() + ")")
            // this.debugLog("addDirtyObject(" + obj.pid() + ")")
            if (!this._dirtyObjects[objId]) {
                this._dirtyObjects[objId] = obj
                this.scheduleStore()
            }
        }

        return this
    },

    scheduleStore: function () {
        if (!SyncScheduler.shared().isSyncingTargetAndMethod(this, "storeDirtyObjects")) {
            if (!SyncScheduler.shared().hasScheduledTargetAndMethod(this, "storeDirtyObjects")) {
                //console.warn("scheduleStore currentAction = ", SyncScheduler.currentAction() ? SyncScheduler.currentAction().description() : null)
                window.SyncScheduler.shared().scheduleTargetAndMethod(this, "storeDirtyObjects", 1000)
            }
        }
        return this
    },

    // ----------------------------------------------------
    // writing
    // ----------------------------------------------------

    debugLog: function (s) {
        this.assertHasUniqueId()

        if (this.debug()) {
            console.log(this.typeId() + ": " + s)
        }
    },

    hasDirtyObjects: function () {
        return Object.keys(this._dirtyObjects).length > 0
    },

    storeDirtyObjects: function () {
        //console.log(" --- storeDirtyObjects --- ")
        this.showDirtyObjects("storing")

        //console.warn("   isSyncingTargetAndMethod = ", SyncScheduler.isSyncingTargetAndMethod(this, "storeDirtyObjects"))

        //console.log(" --- begin storeDirtyObjects --- ")
        if (!this.hasDirtyObjects()) {
            console.log("no dirty objects to store Object.keys(this._dirtyObjects) = ", Reflect.ownKeys(this._dirtyObjects))
            return this
        }

        //this.showDirtyObjects()
        //this.showActiveObjects()


        this.assertIsWritable()

        if (!this.sdb().isOpen()) { // delay until it's open
            throw new Error(this.type() + " storeDirtyObjects but db not open")
        }

        //console.log(" --- begin storeDirtyObjects --- ")
        this.sdb().begin()

        // it's ok to add dirty objects via setPid() while this is
        // working as it will pick it up and won't cause a loop

        var totalStoreCount = 0

        var justStoredPids = {}

        while (true) {

            var thisLoopStoreCount = 0
            var dirtyBucket = this._dirtyObjects
            this._dirtyObjects = {}

            Object.keys(dirtyBucket).forEach((objId) => {
                var obj = dirtyBucket[objId]
                var pid = obj.pid()

                if (justStoredPids[pid]) {
                    throw new Error("attempt to double store " + pid)
                }

                //if (pid[0] == "_" || this.objectIsReferencedByActiveObjects(obj)) {
                this.storeObject(obj)
                justStoredPids[pid] = obj
                //}

                thisLoopStoreCount++
            })

            totalStoreCount += thisLoopStoreCount
            //console.log("totalStoreCount: ", totalStoreCount)
            if (thisLoopStoreCount == 0) {
                break
            }
        }


        this.debugLog("NodeStore.storeDirtyObjects stored " + totalStoreCount + " objects")

        /*
		if (this.debug()) {
			this.show()
		}
		*/

        this.sdb().commit() // flushes write cache
        //console.log("--- commit ---")

        /*
		if (this.debug()) {
			this.collect()
		}
		*/
        //console.log(" --- end storeDirtyObjects --- ")

        return totalStoreCount
    },


    assertIsWritable: function () {
        if (this.isReadOnly()) {
            throw new Error("attempt to write to read-only store")
        }
    },

    storeObject: function (obj) {
        //console.log("store obj")
        this.debugLog("storeObject(" + obj.pid() + ")")
        this.assertIsWritable()

        var aDict = obj.nodeDict()

        if (obj.willStore) {
            obj.willStore(aDict)
        }


        var serializedString = JSON.stringify(aDict)
        this.sdb().atPut(obj.pid(), serializedString)

        /*
        this happens automatically: 
        - when subnode pids are requested for serialization, 
        they are added to dirty object list when pid is assigned
        */

        if (obj.didStore) {
            obj.didStore(aDict)
        }

        return this
    },

    // ----------------------------------------------------
    // pids
    // ----------------------------------------------------

    newPid: function () {
        return Math.floor(Math.random() * Math.pow(10, 17)).toString()
    },

    pidOfObj: function (obj) {
        if (!("_pid" in obj) || obj._pid == null) {
            obj._pid = obj.type() + "_" + this.newPid()
        }
        return obj._pid
    },

    // ----------------------------------------------------
    // reading
    // ----------------------------------------------------


    loadObject: function (obj) {
        try {
            var nodeDict = this.nodeDictAtPid(obj.pid())
            if (nodeDict) {
                //obj.setExistsInStore(true)
                obj.setNodeDict(nodeDict)
                obj.scheduleLoadFinalize()
                return true
            }
        } catch (error) {
            this.setIsReadOnly(true)
            console.log(error.stack, "background: #000; color: #f00")
            throw error
        }

        return false
    },

    nodeDictAtPid: function (pid) {
        var v = this.sdb().at(pid)
        if (v == null) {
            return null
        }
        return JSON.parse(v)
    },

    hasObjectForPid: function (pid) {
        return this.sdb().hasKey(pid)
    },

    objectForPid: function (pid) {
        if (pid == "null") {
            return null
        }

        //console.log("NodeStore.objectForPid(" + pid + ")")

        var activeObj = this.activeObjectsDict()[pid]
        if (activeObj) {
            //this.debugLog("objectForPid(" + pid + ") found in mem")
            return activeObj
        }

        //this.debugLog("objectForPid(" + pid + ")")

        var nodeDict = this.nodeDictAtPid(pid)
        if (!nodeDict) {
            var error = "missing pid '" + pid + "'"
            console.warn("WARNING: " + error)

            // TODO: add a modal panel to allow user to choose to export and clear data
            if(!window.SyncScheduler.shared().hasScheduledTargetAndMethod(this, "clear")) {
                console.warn("WARNING: clearing database because corruption found")
                window.SyncScheduler.shared().scheduleTargetAndMethod(this, "clear")
            }
            return null
            //throw new Error(error)
        }

        var proto = window[nodeDict.type]
        if (!proto) {
            throw new Error("missing proto '" + nodeDict.type + "'")
        }

        var obj = proto.clone()

        if (!obj.justSetPid) {
            throw new Error("stored object of type '" + nodeDict.type + "' missing justSetPid() method")
        }

        // need to set pid before dict to handle circular refs
        obj.justSetPid(pid) // calls addActiveObject()
        obj.setExistsInStore(true)
        //this.debugLog(" nodeDict = ", nodeDict)
        obj.setNodeDict(nodeDict)
        obj.scheduleLoadFinalize()

        //this.debugLog("objectForPid(" + pid + ")")

        return obj
    },

    // ----------------------------------------------------
    // active objects (the read cache)
    // ----------------------------------------------------

    // active objects - one's we've read or written to disk
    // we use a dictionary to track the pids and a WeakMap
    // to connect each pid to a object

    addActiveObject: function (obj) {
        //this.debugLog("addActiveObject(" + obj.pid() + ")")
        this.activeObjectsDict()[obj.pid()] = obj
        return this
    },

    removeActiveObject: function (obj) {
        delete this.activeObjectsDict()[obj.pid()]
        return this
    },

    writeAllActiveObjects: function () {
        Object.slotValues(this.activeObjectsDict()).forEach((obj) => {
            this.storeObject(obj)
        })
        return this
    },

    // references
    //
    //      valid form:
    // 
    //          { <objRefKey>: "<pid>" }
    //
    //      if pid == "null" then object is null
    //

    refValueIfNeeded: function (v) {
        if (typeof (v) == "object") {
            if (v == null || typeof (v.type) == "function") {
                return this.refForObject(v)
            }
        }
        return v
    },

    pidIfRef: function (ref) {
        if (typeof (ref) == "object") {
            if (this.dictIsObjRef(ref)) {
                return ref[this.objRefKey()]
            }
        }
        return null
    },

    unrefValueIfNeeded: function (v) {
        var pid = this.pidIfRef(v)

        if (pid) {
            return this.objectForPid(pid)
        }

        return v
    },

    objRefKey: function () {
        return "pid"
    },

    dictIsObjRef: function (dict) {
        var k = this.objRefKey()
        return typeof (dict[k]) == "string"
    },

    refForObject: function (obj) {
        var k = this.objRefKey()
        var ref = {}

        if (obj === null && typeof (obj) === "object") {
            ref[k] = "null"
        } else {
            ref[k] = obj.pid()
        }

        return ref
    },

    objectForRef: function (ref) {
        var k = this.objRefKey()
        var pid = ref[k]
        if (pid == "null") {
            return null
        }

        return this.objectForPid(pid)
    },

    pidRefsFromPid: function (pid) {
        var nodeDict = this.nodeDictAtPid(pid)
        if (!nodeDict) {
            return []
        }

        var proto = window[nodeDict.type]
        if (!proto) {
            console.warn(this.type() + "pidRefsFromPid(" + pid + ") missing type " + nodeDict.type)
            proto = BMStorableNode
        }

        return proto.nodePidRefsFromNodeDict(nodeDict)
    },

    /*
    pidRefsFromNodeDict: function(nodeDict) {
        var pids = []

        if (nodeDict) {
            // property pids

			Object.keys(nodeDict).forEach((k) => {

                    var v = nodeDict[k]
                    var childPid = this.pidIfRef(v)
                    if (childPid) {
                        pids.push(childPid);
                    }
            })
            
            // child pids
            if (nodeDict.children) {
                nodeDict.children.forEach(function(childPid) {
                    pids.push(childPid)
                })
            }          
        }
        
        return pids
    },
    */

    // ----------------------------------------------------
    // garbage collection
    // ----------------------------------------------------

    rootPids: function () {
        // pids beginning with _ are considered root
        // to delete them you'll need to call removeEntryForPid()

        return this.sdb().keys().select(function (pid) {
            return pid[0] == "_"
        })
    },

    flushIfNeeded: function () {
        if (this.hasDirtyObjects()) {
            this.storeDirtyObjects()
            assert(!this.hasDirtyObjects())
        }
        return this
    },

    collect: function () {
        // this is an on-disk collection
        // in-memory objects aren't considered
        // so we make sure they're flush to the db first 

        this.flushIfNeeded()

        this.debugLog("--- begin collect ---")

        this._marked = {}

        this.rootPids().forEach((rootPid) => {
            this.markPid(rootPid) // this is recursive, but skips marked records
        })

        //this.markActiveObjects() // not needed if assert(!this.hasDirtyObjects()) is above

        var deleteCount = this.sweep()
        this._marked = null

        this.debugLog("--- end collect - collected " + deleteCount + " pids ---")

        return deleteCount
    },

    markActiveObjects: function () {
        Object.keys(this.activeObjectsDict()).forEach((pid) => {
            this._marked[pid] = true
        })
        return this
    },

    markPid: function (pid) {
        //this.debugLog("markPid(" + pid + ")")

        if (this._marked[pid] == true) {
            return false // already marked it
        }
        this._marked[pid] = true

        var refPids = this.pidRefsFromPid(pid)
        //this.debugLog("markPid " + pid + " w refs " + JSON.stringify(refPids))

        refPids.forEach((refPid) => {
            this.markPid(refPid)
        })

        return true
    },

    sweep: function () {
        this.debugLog(" --- sweep --- ")
        // delete all unmarked records
        this.sdb().begin()

        var deleteCount = 0
        var pids = this.sdb().keys()

        pids.forEach((pid) => {
            if (this._marked[pid] != true) {
                this.debugLog("deletePid(" + pid + ")")
                this.sdb().removeAt(pid)
                deleteCount++
            }
        })

        this.sdb().commit()

        return deleteCount
    },

    justRemovePid: function (pid) { // private
        this.sdb().begin()
        this.sdb().removeAt(pid)
        this.sdb().commit()
        return this
    },

    // transactions

    begin: function () {
        throw new Error("transactions not implemented yet")

    },

    commit: function () {
        throw new Error("transactions not implemented yet")
    },

    asJson: function () {
        return this.sdb().asJson()
    },

    clear: function () {
        console.warn("====================================")
        console.warn("=== NodeStore clearing all data! ===")
        console.warn("====================================")
        //throw new Error("NodeStore clearing all data!")
        this.sdb().clear();
    },

    show: function () {
        console.log("--- NodeStore show ---")
        this.rootPids().forEach((pid) => {
            this.showPid(pid, 1, 3)
        })
        console.log("----------------------")
        //this.sdb().idb().show()
        return this
    },

    showPid: function (pid, level, maxLevel) {
        if (level > maxLevel) {
            return
        }

        var stringReplacer = function (value) {
            if (typeof (value) === "string" && value.length > 100) {
                return value.substring(0, 100) + "...";
            }
            return value
        }

        var replacer = function (key, value) {
            value = stringReplacer(value)

            if (typeof(value) == "array") {
                return value.map(stringReplacer)
            }
            return value;
        }

        var indent = "   ".repeat(level)
        var nodeDict = this.nodeDictAtPid(pid)
        console.log(indent + pid + ": " + JSON.stringify(nodeDict, replacer, 2 + indent.length))

        if (nodeDict.children) {
            nodeDict.children.forEach((childPid) => {
                this.showPid(childPid, level + 1, maxLevel)
            })
        }
        return this
    },

    showDirtyObjects: function (prefixString) {
        let dirty = this._dirtyObjects
        if (!prefixString) {
            prefixString = ""
        }
        //console.log("dirty objects: ")
        //console.log("dirty objects:  " + Reflect.ownKeys(dirty).join(", "))
        console.log(prefixString + " dirty objects: " + Object.keys(dirty).map((k) => dirty[k].typeId()).join(", "))


        return this
    },

    showActiveObjects: function () {
        var active = this.activeObjectsDict()
        console.log("active objects: ")

        Object.keys(active).forEach((pid) => {
            var obj = active[pid]
            console.log("    " + pid + ": ", Object.keys(obj.nodeRefPids()))
        })

        var pid = "_localIdentities"
        var obj = active[pid]
        //debugger;
        console.log("    " + pid + ": ", Object.keys(obj.nodeRefPids()))

        return this
    },

    objectIsReferencedByActiveObjects: function (aNode) {
        var nodePid = aNode.pid()
        var active = this.activeObjectsDict()

        var result = Object.keys(active).detect((pid) => {
            var obj = active[pid]
            var match = (!(obj === aNode)) && obj.nodeReferencesPid(nodePid)
            return match
        }) != null

        if (!result) {
            //console.log(">>>>>> " + aNode.pid() + " is unreferenced - not storing!")
        }
        return result
    },
})
