	var graph_id = scope.$id;

	var metric = scope.panel.metric_field;
	var labelcolor = false;

	if (dashboard.current.style === 'dark'){
		labelcolor = true;
	}

	var graph = echarts.init(dobument.getElementById(graph_id));

    // This variation on ForceDirectedLayout does not move any selected
	// Nodes
	// but does move all other nodes (vertexes).
	function ContinuousForceDirectedLayout() {
		go.ForceDirectedLayout.call(this);
	    this._isObserving = false;
	}
	go.Diagram.inherit(ContinuousForceDirectedLayout, go.ForceDirectedLayout);

	/** @override */
	ContinuousForceDirectedLayout.prototype.isFixed = function(v) {
	    return v.node.isSelected;
	}

	// optimization: reuse the ForceDirectedNetwork rather than re-create it
	// each time
	/** @override */
	ContinuousForceDirectedLayout.prototype.doLayout = function(coll) {
		if (!this._isObserving) {
	    this._isObserving = true;
	    // cacheing the network means we need to recreate it if nodes or
		// links have been added or removed or relinked,
        // so we need to track structural model changes to discard the saved
		// network.
	    var lay = this;
	    this.diagram.addModelChangedListener(function (e) {
	        // modelChanges include a few cases that we don't actually care
			// about, such as
	        // "nodeCategory" or "linkToPortId", but we'll go ahead and recreate
			// the network anyway.
	        // Also clear the network when replacing the model.
	        if (e.modelChange !== "" || (e.change === go.ChangedEvent.Transaction && e.propertyName === "StartingFirstTransaction")) {
	          lay.network = null;
	        }
	      });
	    }
	    var net = this.network;
	    if (net === null) {                                  // the first time, just create the network as
						                                     // normal
	      this.network = net = this.makeNetwork(coll);
	    } else {                                             // but on reuse we need to update the LayoutVertex.bounds
					                                         // for selected nodes
	      this.diagram.nodes.each(function (n) {
	        var v = net.findVertex(n);
	        if (v !== null) v.bounds = n.actualBounds;
	      });
	    }
	    // now perform the normal layout
	    go.ForceDirectedLayout.prototype.doLayout.call(this, coll);
	    // doLayout normally discards the LayoutNetwork by setting
		// Layout.network to null;
	    // here we remember it for next time
	    this.network = net;
	}
	// end ContinuousForceDirectedLayout

	function drawGraph(nodeDataArray, linkDataArray, graph_id) {
		var $ = go.GraphObject.make;  // for conciseness in defining templates
		
		myDiagram =
			$(go.Diagram, graph_id,  // create a Diagram for the DIV HTML
											// element
			{
				initialAutoScale: go.Diagram.Uniform,   // an initial automatic
														// zoom-to-fit
		        contentAlignment: go.Spot.Center,       // align document to the
														// center of the
														// viewport
		        layout:
		            $(ContinuousForceDirectedLayout,    // automatically spread
			        									// nodes apart while
														// dragging
		            { defaultSpringLength: 30, defaultElectricalCharge: 100 }),
		            // do an extra layout at the end of a move
		            "SelectionMoved": function(e) { e.diagram.layout.invalidateLayout(); }
			});
		
		myDiagram.toolManager.draggingTool.doMouseMove = function() {
		    go.DraggingTool.prototype.doMouseMove.call(this);
		    if (this.isActive) { this.diagram.layout.invalidateLayout(); }
		}
		
			    // These nodes have text surrounded by a rounded rectangle
			    // whose fill color is bound to the node data.
			    // The user can drag a node by dragging its TextBlock label.
			    // Dragging from the Shape will start drawing a new link.
	    myDiagram.nodeTemplate =
		    $(go.Node, "Auto",  // the whole node panel define the node's outer shape, which will surround the TextBlock
			  $(go.Shape, "Circle",
			    { fill: "CornflowerBlue", stroke: "black", spot1: new go.Spot(0, 0, 5, 5), spot2: new go.Spot(1, 1, -5, -5) }),
			  $(go.TextBlock,
			    { font: "bold 10pt helvetica, bold arial, sans-serif", textAlign: "center", maxSize: new go.Size(100, NaN) },
			    new go.Binding("text", "key")),
			    {
			        click: function(e, obj) { window.selected_var=obj.part.data.key;showMessage(obj.part.data.key); },
			        selectionChanged: function(part) {
				    	var shape = part.elt(0);
				    	shape.fill = part.isSelected ? "red" : "CornflowerBlue";
			        }
			    }
		    );
		
			    // The link shape and arrowhead have their stroke brush data
				// bound to the "color" property
		myDiagram.linkTemplate =
			$(go.Link,  // the whole link panel
			  $(go.Shape,  // the link shape
			    { stroke: "black" }),
			  $(go.Shape,  // the arrowhead
			    { toArrow: "standard", stroke: null })
			  );
		myDiagram.model = new go.GraphLinksModel(nodeDataArray, linkDataArray);
	}
	
	function reload() {
	    //myDiagram.layout.network = null;
	    var text = myDiagram.model.toJson();
	    myDiagram.model = go.Model.fromJson(text);
	    //myDiagram.layout =
	    //  go.GraphObject.make(ContinuousForceDirectedLayout,  // automatically spread nodes apart while dragging
	    //    { defaultSpringLength: 30, defaultElectricalCharge: 100 });
	}
	
	function showMessage(s) {
		alert("klick: "+s+".");
	}
