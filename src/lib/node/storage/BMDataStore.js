"use strict"

//	BMDataStore
//	A visible representation of the NodeStore


window.BMDataStore = BMNode.extend().newSlots({
    type: "BMDataStore",
}).setSlots({
    init: function () {
        BMNode.init.apply(this)
        this.setTitle("DataStore")
        this.setNodeMinWidth(300)
    },

    subtitle: function () {
        return this.store().shortStatsString()
    },

    store: function () {
        return NodeStore.shared()
    },

    prepareToSyncToView: function () {
        if (this.subnodes().length == 0) {
            this.refreshSubnodes()
        }
    },

    refreshSubnodes: function () {
        //console.log(this.type() + " refreshSubnodes")
        this.removeAllSubnodes()
        this.store().sdb().keys().sort().forEach((key) => {
            var subnode = BMDataStoreRecord.clone().setTitle(key)
            var size = this.store().sdb().at(key).length
            var sizeDescription = ByteFormatter.clone().setValue(size).formattedValue()
            subnode.setSubtitle(sizeDescription)
            this.addRecord(subnode)
        })
    },

    subnodeForClassName: function (aClassName) {
        var subnode = this.firstSubnodeWithTitle(aClassName)
        if (!subnode) {
            subnode = BMNode.clone().setTitle(aClassName).setNoteIsSubnodeCount(true)
            this.justAddSubnode(subnode)
        }
        return subnode
    },

    addRecord: function (aRecord) {
        var className = aRecord.title().split("_").first()

        if (className == "") {
            className = "roots"
        }

        var classNode = this.subnodeForClassName(className)
        classNode.setNodeMinWidth(300)
        classNode.justAddSubnode(aRecord)
        return this
    },
})
