/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

(function () {
    "use strict";

    var util = require("util"),
        assert = require("assert");

    function BaseLayer(group, raw) {
        this.group = group;

        this.id = raw.id;
        this.index = raw.index;
        this.type = raw.type;
        this.name = raw.name;
        this.bounds = raw.bounds;
        this.visible = raw.visible;
        this.clipped = raw.clipped;
        this.mask = raw.mask;
        this.generatorSettings = raw.generatorSettings; // FIXME
    }

    BaseLayer.prototype.toString = function () {
        return this.id + ":" + (this.name || "-");
    };

    BaseLayer.prototype.getSize = function () {
        return 1;
    };

    BaseLayer.prototype.setName = function (name) {
        if (this.name !== name) {
            var previousName = name;
            this.name = name;
            return ["rename", name, previousName];
        }
    };

    BaseLayer.prototype.detach = function () {
        if (!this.group) {
            return;
        }

        var parent = this.group,
            id = this.id,
            index = -1;

        parent.layers.some(function (child, i) {
            if (child.id === id) {
                index = i;
                return true;
            }
        }, this);

        assert(index > -1, "Unable to detach layer from parent");
        parent.layers.splice(index, 1);
    };

    BaseLayer.prototype._applyChange = function (change) {
        assert.strictEqual(this.id, change.id, "Layer ID mismatch.");

        var changes = [],
            result;

        if (change.hasOwnProperty("name")) {
            result = this.setName(change.name);
            if (change) {
                changes.push(changes);
            }
        }

        return changes;
    };

    function Layer(group, raw) {
        BaseLayer.call(this, group, raw);
        this.pixels = raw.pixels;
    }
    util.inherits(Layer, BaseLayer);

    function BackgroundLayer(group, raw) {
        BaseLayer.call(this, group, raw);
        this.protection = raw.protection;
        this.pixels = raw.pixels;
    }
    util.inherits(BackgroundLayer, BaseLayer);

    function ShapeLayer(group, raw) {
        BaseLayer.call(this, group, raw);
        this.fill = raw.fill;
        this.path = raw.path;
    }
    util.inherits(ShapeLayer, BaseLayer);

    function TextLayer(group, raw) {
        BaseLayer.call(this, group, raw);
        this.text = raw.text;
    }
    util.inherits(TextLayer, BaseLayer);

    function AdjustmentLayer(group, raw) {
        BaseLayer.call(this, group, raw);
        this.adjustment = raw.adjustment;
    }
    util.inherits(AdjustmentLayer, BaseLayer);

    function SmartObjectLayer(group, raw) {
        BaseLayer.call(this, group, raw);
        this.smartObject = raw.smartObject;
        this.timeContent = raw.timeContent;
    }
    util.inherits(SmartObjectLayer, BaseLayer);

    function LayerGroup(group, raw) {
        BaseLayer.call(this, group, raw);
        this.blendOptions = raw.blendOptions;

        var targetIndex = 0;

        this.layers = [];
        if (raw.hasOwnProperty("layers")) {
            raw.layers
                .sort(function (l1, l2) {
                    return l1.index - l2.index;
                })
                .forEach(function (rawLayer) {
                    var layer = createLayer(this, rawLayer);

                    targetIndex += layer.getSize() - 1;

                    this.addLayerAtIndex(layer, targetIndex);

                    targetIndex++;
                }, this);
        }
    }
    util.inherits(LayerGroup, BaseLayer);

    LayerGroup.prototype.getSize = function () {
        return this.layers.reduce(function (size, layer) {
            return size + layer.getSize();
        }, 2);
    };

    LayerGroup.prototype.toString = function () {
        var result = BaseLayer.prototype.toString.call(this),
            length = this.layers.length;

        result += " [";
        this.layers.forEach(function (layer, index) {
            result += layer.toString();
            if (index !== length - 1) {
                result += ", ";
            }
        });
        result += "]";

        return result;
    };

    LayerGroup.prototype.addLayerAtIndex = function (childToAdd, targetIndex) {
        var currentIndex = childToAdd.getSize() - 1,
            nextIndex = currentIndex,
            child;

        // Invariant: currentIndex <= targetIndex
        var index;
        for (index = 0; index < this.layers.length; index++) {
            if (targetIndex <= currentIndex) {
                break;
            }

            // currentIndex < targetIndex
            child = this.layers[index];
            nextIndex += child.getSize();

            // nextIndex <= targetIndex
            if (targetIndex < nextIndex && child instanceof LayerGroup) {
                // currentIndex < targetIndex < nextIndex
                child.addLayerAtIndex(childToAdd, targetIndex - (currentIndex + 1));
                return;
            }

            //currentIndex <= targetIndex
            currentIndex = nextIndex;
        }

        assert.strictEqual(currentIndex, targetIndex, "Invalid insertion index: " + targetIndex);
        childToAdd.group = this;
        this.layers.splice(index, 0, childToAdd);
    };

    LayerGroup.prototype.findLayer = function (id) {
        var currentIndex = 0,
            result;

        this.layers.some(function (child) {
            if (child instanceof LayerGroup) {
                currentIndex++;
                result = child.findLayer(id);
                if (result) {
                    result.index += currentIndex;
                    return true;
                } else {
                    currentIndex += child.getSize() - 2;
                }
            } 

            if (child.id === id) {
                result = {
                    layer: child,
                    index: currentIndex
                };
                return true;
            }

            currentIndex++;
        });

        return result;
    };

    LayerGroup.prototype._applyChange = function (changedLayers, rawLayerChanges, parentIndex) {
        var finalSize = this.getSize();

        rawLayerChanges.sort(function (l1, l2) {
            return l1.index - l2.index;
        });

        // recursively apply each child layer's changes
        rawLayerChanges.forEach(function (rawLayerChange) {
            if (!rawLayerChange.hasOwnProperty("index")) {
                return;
            }

            var id = rawLayerChange.id,
                child;

            if (rawLayerChange.added) {
                child = createLayer(this, rawLayerChange);
                changedLayers[id].layer = child;
            } else {
                if (!changedLayers.hasOwnProperty(id)) {
                    if (rawLayerChange.removed) {
                        return;
                    } else {
                        throw new Error("Can't find changed layer:", id);
                    }
                }

                child = changedLayers[id].layer;
            }

            if (rawLayerChange.hasOwnProperty("layers")) {
                child._applyChange(changedLayers, rawLayerChange.layers, rawLayerChange.index);
            }
            
            if (!rawLayerChange.removed) {
                finalSize += child.getSize();
            }
        }, this);

        // Add the child at the new index
        var offset;
        if (parentIndex === undefined) {
            offset = 0;
        } else {
            offset = parentIndex - (finalSize - 2);
        }

        rawLayerChanges.forEach(function (rawLayerChange) {
            if (!rawLayerChange.hasOwnProperty("index") || rawLayerChange.removed) {
                return;
            }

            var id = rawLayerChange.id;

            if (!changedLayers.hasOwnProperty(id)) {
                console.warn("Skipping group end layer:", id);
                return;
            }

            var index = rawLayerChange.index,
                relativeIndex = index - offset,
                layerRec = changedLayers[id],
                child = layerRec.layer;

            layerRec.previousGroup = child.group;
            this.addLayerAtIndex(child, relativeIndex);
        }, this);
    };

    function createLayer(parent, rawLayer) {
        if (!parent && !rawLayer.hasOwnProperty("type")) {
            return new LayerGroup(null, rawLayer);
        }

        switch (rawLayer.type) {
            case "layerSection":
                return new LayerGroup(parent, rawLayer);
            case "layer":
                return new Layer(parent, rawLayer);
            case "shapeLayer":
                return new ShapeLayer(parent, rawLayer);
            case "textLayer":
                return new TextLayer(parent, rawLayer);
            case "adjustmentLayer":
                return new AdjustmentLayer(parent, rawLayer);
            case "smartObjectLayer":
                return new SmartObjectLayer(parent, rawLayer);
            case "backgroundLayer":
                return new BackgroundLayer(parent, rawLayer);
            default:
                throw new Error("Unknown layer type:", rawLayer.type);
        }
    }

    exports.createLayer = createLayer;
}());