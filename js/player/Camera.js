/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {CameraState} from "../model/CameraState";

// Constant: the Sozi namespace
var SVG_NS = "http://www.w3.org/2000/svg";

export var Camera = Object.create(CameraState);

Camera.init = function (viewport, layer) {
    CameraState.init.call(this, viewport.svgRoot);

    this.viewport = viewport;
    this.layer = layer;
    this.selected = true;
    this.maskValue = 0;

    // The clipping rectangle of this camera
    this.svgMaskRect = document.createElementNS(SVG_NS, "rect");
    this.svgClipRect = document.createElementNS(SVG_NS, "rect");
    this.svgClipRect.setAttribute("fill", "white");

    this.svgClipOutlineRect1 = document.createElementNS(SVG_NS, "rect");
    this.svgClipOutlineRect1.setAttribute("stroke", "black");
    this.svgClipOutlineRect1.setAttribute("fill", "none");

    this.svgClipOutlineRect2 = document.createElementNS(SVG_NS, "rect");
    this.svgClipOutlineRect2.setAttribute("stroke", "white");
    this.svgClipOutlineRect2.setAttribute("fill", "none");
    this.svgClipOutlineRect2.setAttribute("stroke-dasharray", "2,2");

    // The clipping path of this camera
    var svgMask = document.createElementNS(SVG_NS, "mask");
    var svgMaskId = viewport.makeUniqueId("sozi-mask-");
    svgMask.setAttribute("id", svgMaskId);
    svgMask.appendChild(this.svgMaskRect);
    svgMask.appendChild(this.svgClipRect);
    viewport.svgRoot.appendChild(svgMask);
    viewport.svgRoot.appendChild(this.svgClipOutlineRect1);
    viewport.svgRoot.appendChild(this.svgClipOutlineRect2);

    // The group that will support the clipping operation
    var svgClippedGroup = document.createElementNS(SVG_NS, "g");
    svgClippedGroup.setAttribute("mask", "url(#" + svgMaskId + ")");
    viewport.svgRoot.appendChild(svgClippedGroup);

    // The groups that will support transformations
    this.svgTransformGroups = layer.svgNodes.map(svgNode => {
        var svgGroup = document.createElementNS(SVG_NS, "g");
        svgGroup.appendChild(svgNode);
        svgClippedGroup.appendChild(svgGroup);
        return svgGroup;
    });

    this.concealClipping();

    return this;
};

Camera.revealClipping = function () {
    this.maskValue = 64;
    this.svgClipOutlineRect1.style.display = "inline";
    this.svgClipOutlineRect2.style.display = "inline";
};

Camera.concealClipping = function () {
    this.maskValue = 0;
    this.svgClipOutlineRect1.style.display = "none";
    this.svgClipOutlineRect2.style.display = "none";
};

Object.defineProperty(Camera, "scale", {
    get() {
        return Math.min(this.viewport.width / this.width, this.viewport.height / this.height);
    }
});

Camera.rotate = function (angle) {
    this.restoreAspectRatio();
    return this.setAngle(this.angle + angle).update();
};

Camera.zoom = function (factor, x, y) {
    this.width /= factor;
    this.height /= factor;
    this.restoreAspectRatio();
    return this.translate(
        (1 - factor) * (x - this.viewport.width  / 2),
        (1 - factor) * (y - this.viewport.height / 2)
    );
};

Camera.translate = function (deltaX, deltaY) {
    var scale = this.scale;
    var angleRad = this.angle * Math.PI / 180;
    var si = Math.sin(angleRad);
    var co = Math.cos(angleRad);
    this.cx -= (deltaX * co - deltaY * si) / scale;
    this.cy -= (deltaX * si + deltaY * co) / scale;
    this.restoreAspectRatio();
    return this.update();
};

Camera.clip = function (x0, y0, x1, y1) {
    this.clipped = true;
    var scale = this.scale;
    var clipWidth = Math.abs(x1 - x0);
    var clipHeight = Math.abs(y1 - y0);
    this.clipXOffset = (Math.min(x0, x1) - (this.viewport.width  - clipWidth)  / 2) * this.width  / clipWidth;
    this.clipYOffset = (Math.min(y0, y1) - (this.viewport.height - clipHeight) / 2) * this.height / clipHeight;
    this.clipWidthFactor  = clipWidth  / this.width  / scale;
    this.clipHeightFactor = clipHeight / this.height / scale;
    return this.update();
};

Camera.restoreAspectRatio = function () {
    var viewportRatio = this.viewport.width / this.viewport.height;
    var camRatio = this.width / this.height;
    var ratio = viewportRatio / camRatio;
    if (ratio > 1) {
        this.width *= ratio;
        if (this.clipped) {
            this.clipWidthFactor /= ratio;
        }
    }
    else {
        this.height /= ratio;
        if (this.clipped) {
            this.clipHeightFactor *= ratio;
        }
    }
};

Camera.getCandidateReferenceElement = function () {
    // getIntersectionList is not supported in Gecko
    if (!this.svgRoot.getIntersectionList) {
        return this.svgRoot;
    }

    // Get all elements that intersect with the viewport.
    var viewportRect = this.svgRoot.createSVGRect();
    viewportRect.x = 0;
    viewportRect.y = 0;
    viewportRect.width = this.viewport.width;
    viewportRect.height = this.viewport.height;
    var viewportArea = this.viewport.width * this.viewport.height;

    var intersectionList = this.svgRoot.getIntersectionList(viewportRect, this.layer.svgNodes[0]);

    // Find the element which bounding box best fits in the viewport.
    var bestScore = -1;
    var result;

    for (var i = 0; i < intersectionList.length; i ++) {
        var elt = intersectionList[i];
        if (elt.hasAttribute("id")) {
            // TODO getBoundingClientRect returns bounding box of bounding box
            var eltRect = elt.getBoundingClientRect();
            var eltArea = eltRect.width * eltRect.height;

            // Compute the intersection of the element'b bounding
            // box with the current viewport.
            var l = Math.max(eltRect.left, this.viewport.x);
            var t = Math.max(eltRect.top, this.viewport.y);
            var r = Math.min(eltRect.right, this.viewport.x + this.viewport.width);
            var b = Math.min(eltRect.bottom, this.viewport.y + this.viewport.height);

            var intersectArea = (r - l) * (b - t);

            // An element is selected if it has the biggest intersect area
            // and the smallest area outside the intersection.
            var eltScore = viewportArea + eltArea - 2 * intersectArea;
            if (bestScore < 0 || eltScore < bestScore) {
                bestScore = eltScore;
                result = elt;
            }
        }
    }

    return result;
};

Camera.update = function () {
    var scale = this.scale;

    // Adjust the location and size of the clipping rectangle
    var clipWidth, clipHeight, clipX, clipY;

    if (this.clipped) {
        clipWidth  = Math.round(this.width  * this.clipWidthFactor  * scale);
        clipHeight = Math.round(this.height * this.clipHeightFactor * scale);
        clipX = Math.round((this.viewport.width  - clipWidth)  / 2 + this.clipXOffset * this.clipWidthFactor  * scale);
        clipY = Math.round((this.viewport.height - clipHeight) / 2 + this.clipYOffset * this.clipHeightFactor * scale);
    }
    else {
        clipWidth = this.viewport.width;
        clipHeight = this.viewport.height;
        clipX = 0;
        clipY = 0;
    }

    this.svgMaskRect.setAttribute("fill", "rgb(" + this.maskValue + "," + this.maskValue + "," + this.maskValue + ")");
    this.svgMaskRect.setAttribute("x", 0);
    this.svgMaskRect.setAttribute("y", 0);
    this.svgMaskRect.setAttribute("width",  this.viewport.width);
    this.svgMaskRect.setAttribute("height", this.viewport.height);

    this.svgClipRect.setAttribute("x", clipX);
    this.svgClipRect.setAttribute("y", clipY);
    this.svgClipRect.setAttribute("width",  clipWidth);
    this.svgClipRect.setAttribute("height", clipHeight);

    this.svgClipOutlineRect1.setAttribute("x", clipX);
    this.svgClipOutlineRect1.setAttribute("y", clipY);
    this.svgClipOutlineRect1.setAttribute("width",  clipWidth);
    this.svgClipOutlineRect1.setAttribute("height", clipHeight);

    this.svgClipOutlineRect2.setAttribute("x", clipX);
    this.svgClipOutlineRect2.setAttribute("y", clipY);
    this.svgClipOutlineRect2.setAttribute("width",  clipWidth);
    this.svgClipOutlineRect2.setAttribute("height", clipHeight);

    // Compute and apply the geometrical transformation to the layer group
    var translateX = this.viewport.width  / scale / 2 - this.cx;
    var translateY = this.viewport.height / scale / 2 - this.cy;

    this.svgTransformGroups.forEach(svgGroup => {
        svgGroup.setAttribute("transform",
            "scale(" + scale + ")" +
            "translate(" + translateX + "," + translateY + ")" +
            "rotate(" + (-this.angle) + ',' + this.cx + "," + this.cy + ")"
        );
    });

    return this;
};
