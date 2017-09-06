

BMChatMessageRowView = BrowserTitledRow.extend().newSlots({
    type: "BMChatMessageRowView",
}).setSlots({
    
    init: function () {
        BrowserTitledRow.init.apply(this)
	//	this.setSelectedBgColor("white")
	//	this.setUnselectedBgColor("white")

		this.setDisplay("block")
		
		this.setMinHeight("auto")
		this.setMaxHeight("1000px")
		this.setHeight("auto")
		
		this.setPaddingTop(10)
		this.setMarginBottom(10)
		
		this.setupTitleView()
    },
    
    setupTitleView: function() {
		this.titleView().insertDivClassName(this.type() + "Title")
		this.titleView().setWidth("auto")
		this.titleView().setMinWidth("50px")
		this.titleView().setMaxWidth("calc(100% - 100px)")

		this.titleView().setTop(0)
		this.titleView().setPosition("relative")
		this.titleView().setLeft(null)
		this.titleView().setMarginRight(20)
		this.titleView().setMarginLeft(0)
    },
    
    alignToRight: function() {
	    this.titleView().setRight(20)
		this.titleView().setFloat("right")
	    this.titleView().setBorderRadius("8px 8px 0px 8px") // top-left, top-right,  bottom-right, bottom-left
		this.titleView().setBackgroundColor("rgb(84, 193, 250)")
		this.titleView().setColor("white")
	    return this
    },
    
    alignToLeft: function() {
        this.titleView().setLeft(20)
    	this.titleView().setFloat("left")
        this.titleView().setBorderRadius("8px 8px 8px 0px") // top-left, top-right,  bottom-right, bottom-left 
		this.titleView().setBackgroundColor("#888")
		this.titleView().setColor("black")
	    return this
    },

    setHasSubtitle: function(aBool) {        
		// so it doesn't adjust title 
        return this
    },

	message: function() {
		return this.node()
	},

    updateSubviews: function() {
		BrowserTitledRow.updateSubviews.apply(this)
		
		if (this.node()) {
			this.titleView().setInnerHTML(this.node().title())
		
			if (this.message().wasSentByMe()) {
				this.styleAsSent()
			} else {
				this.styleAsReceived()
			}
		}
		
		return this
	},
	
	styleAsSent: function() {
		this.alignToRight()
	},
	
	styleAsReceived: function() {
		this.alignToLeft()
	},
})

