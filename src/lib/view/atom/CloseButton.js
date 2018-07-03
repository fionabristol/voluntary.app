"use strict"

window.CloseButton = DivView.extend().newSlots({
    type: "CloseButton",
    isEnabled: true,
}).setSlots({

    init: function () {
        DivView.init.apply(this)

        this.turnOffUserSelect()

        this.setDivClassName("ImageCloseButton")
        this.setBackgroundImageUrlPath(this.pathForIconName("close"))
        this.setBackgroundSizeWH(10, 10) // use "contain" instead?
        this.setBackgroundPosition("center")
        this.makeBackgroundNoRepeat()
        this.setAction("close") //.setInnerHTML("&#10799;")

        return this
    },

    // --- editable ---
    
    setIsEnabled: function(aBool) {
        if (this._isEnabled != aBool) {
            this._isEnabled = aBool
            this.syncEnabled()
        }

        return this
    },

    syncEnabled: function() {
        if (this._isEnabled) {
            this.setDisplay("inline-block")
        } else {
            this.setDisplay("none")
        }
        return this
    },

})