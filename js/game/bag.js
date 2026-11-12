'use strict'
// Bluff crescent sling bag.
// One continuous loop of fabric worn across the body: a wide flat strap over
// the shoulder and chest that swells into a soft half-moon pouch on the back.
// Built in the character's upper-spine bone space (model units, +Y up the spine,
// +X to the character's left, +Z forward).
define(["three"], (THREE) =>
{
    var Bag =
    {
        // fit of the loop around the torso
        centre : new THREE.Vector3(2.5, -7.5, 3.6), // middle of the loop
        shoulder : new THREE.Vector3(-6, 9.5, 3.6), // top of the loop (right shoulder)
        half_depth : 9.1,                          // front-to-back radius of the loop
        squareness : 2.6,                          // >2 hugs a boxy torso instead of a round one

        // strap
        strap_half_width : 2.6,
        strap_half_thickness : 0.35,

        // pouch
        pouch_angle : -1.95,          // where on the loop the pouch sits (back, low)
        pouch_span : 1.75,            // half of the angle the pouch covers
        pouch_half_width : 9.0,
        pouch_half_thickness : 3.0,

        loop_segments : 160,
        section_segments : 20,

        create : function()
        {
            var mesh = new THREE.Mesh(this.createGeometry(), this.createMaterial());
            mesh.name = "BluffBag";
            mesh.frustumCulled = false;
            return mesh;
        },

        // matte black ripstop nylon: near-black, rough, with a fine woven grid
        createMaterial : function()
        {
            var size = 64;
            var canvas = document.createElement("canvas");
            canvas.width = canvas.height = size;
            var ctx = canvas.getContext("2d");
            ctx.fillStyle = "#808080";
            ctx.fillRect(0, 0, size, size);
            // fine weave
            ctx.fillStyle = "#767676";
            for (var i = 0; i < size; i += 2)
            {
                ctx.fillRect(i, 0, 1, size);
                ctx.fillRect(0, i, size, 1);
            }
            // raised ripstop threads
            ctx.fillStyle = "#b0b0b0";
            for (var j = 0; j < size; j += 16)
            {
                ctx.fillRect(j, 0, 2, size);
                ctx.fillRect(0, j, size, 2);
            }

            var bump = new THREE.CanvasTexture(canvas);
            bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
            bump.repeat.set(40, 8);

            return new THREE.MeshStandardMaterial(
            {
                color : 0x030304,
                roughness : 0.92,
                metalness : 0.0,
                bumpMap : bump,
                bumpScale : 0.0015,
                side : THREE.DoubleSide,
            });
        },

        // 0 on the strap, 1 in the middle of the pouch
        pouchWeight : function(t)
        {
            var d = Math.atan2(Math.sin(t - this.pouch_angle), Math.cos(t - this.pouch_angle));
            var x = Math.abs(d) / this.pouch_span;
            if (x >= 1) return 0;
            // half-moon profile: full in the middle, tapering to points
            return Math.pow(Math.cos(x * Math.PI / 2), 0.9);
        },

        createGeometry : function()
        {
            var n = this.loop_segments, m = this.section_segments;

            // loop frame: `up` runs from the low hip to the shoulder,
            // `fwd` is front-to-back, `side` is across the fabric's width
            var up = this.shoulder.clone().sub(this.centre);
            var half_height = up.length();
            up.normalize();
            var fwd = new THREE.Vector3(0, 0, 1);
            var side = new THREE.Vector3().crossVectors(up, fwd).normalize();
            // make `side` point down the body so the pouch belly hangs below the strap
            if (side.y > 0) side.negate();

            var e = 2 / this.squareness;
            var spow = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);

            var loopPoint = (t) =>
            {
                return this.centre.clone()
                    .addScaledVector(up, half_height * spow(Math.cos(t)))
                    .addScaledVector(fwd, this.half_depth * spow(Math.sin(t)));
            };

            var positions = [], uvs = [], indices = [];
            var p = new THREE.Vector3(), out = new THREE.Vector3(), v = new THREE.Vector3();

            for (var i = 0; i <= n; i++)
            {
                var t = (i / n) * Math.PI * 2;
                p.copy(loopPoint(t));

                // outward direction: perpendicular to the loop, in the loop plane
                var tangent = loopPoint(t + 0.01).sub(loopPoint(t - 0.01)).normalize();
                out.crossVectors(tangent, side).normalize();
                if (out.dot(p.clone().sub(this.centre)) < 0) out.negate();

                var w = this.pouchWeight(t);
                var half_w = this.strap_half_width + (this.pouch_half_width - this.strap_half_width) * w;
                var half_t = this.strap_half_thickness + (this.pouch_half_thickness - this.strap_half_thickness) * w;
                // soft folds so the pouch reads as slouchy fabric, not a tube
                var slouch = 1 + 0.07 * w * Math.sin(t * 9.0) + 0.05 * w * Math.sin(t * 17.0 + 1.3);
                half_t *= slouch;

                // keep the top edge in line with the strap, let the belly hang down,
                // and rest the inner face against the body
                var drop = (half_w - this.strap_half_width);
                var lift = half_t;

                for (var j = 0; j <= m; j++)
                {
                    var a = (j / m) * Math.PI * 2;
                    var ca = Math.cos(a), sa = Math.sin(a);
                    // flatter on the body side, fuller on the outside
                    var bulge = sa > 0 ? 1.0 : 0.45;
                    // belly is fuller toward the bottom edge of the pouch
                    var belly = 1 + 0.25 * w * Math.max(0, ca);

                    v.copy(p)
                        .addScaledVector(side, drop + half_w * ca)
                        .addScaledVector(out, lift * 0.55 + half_t * sa * bulge * belly);

                    positions.push(v.x, v.y, v.z);
                    uvs.push(i / n, j / m);
                }
            }

            for (var i = 0; i < n; i++)
            {
                for (var j = 0; j < m; j++)
                {
                    var a0 = i * (m + 1) + j;
                    var b0 = (i + 1) * (m + 1) + j;
                    indices.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
                }
            }

            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();
            return geometry;
        },
    };

    return Bag;
});
