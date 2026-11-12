'use strict'
// Bluff City: a small walkable town built on a plateau in the valley.
// World axes: +Z is up, +Y is north. One unit is roughly 1.6 m (the player is ~1 unit tall).
//
// Layout (top view, north up):
//
//        graffiti park  |  BLUFF STORE  |  tree park
//      -----------------+---------------+-----------------
//         shops         |  main street  |     shops
//      ---- cross street (logo roundabout in the middle) ---- gate + bridge east
//         shops         |  main street  |     shops
//
define(["three", "scene", "physics", "bag"], (THREE, scene, Physics, Bag) =>
{
    var HALF = 70;              // the city deck spans -HALF..HALF in x and y
    var DECK_Z = 23;            // height of the streets (just above the valley floor's highest point)
    var STREET = 4;             // half width of a street
    var FRONT = 7;              // distance from a street's centre line to the shop fronts
    var DEPTH = 14;             // building depth
    var FLOOR = 3;              // floor height
    var BAY = 2.4;              // width of one window bay

    // palette taken from the logo: charcoal and white, with concrete in between
    var C =
    {
        charcoal : "#262626", ink : "#141414", white : "#f2f0ea", concrete : "#b9b6ae",
        pavement : "#c9c6be", asphalt : "#2f2f31", glass : "#1d2a33", glass_lit : "#f5d98a",
        accent : "#e4472b",
    };

    var City =
    {
        HALF : HALF,
        DECK_Z : DECK_Z,
        spawn : new THREE.Vector3(0, -30, DECK_Z + 2),
        group : new THREE.Group(),
        spinners : [],
        logo_image : null,
        logo_waiters : [],
        seed : 7,

        init : function()
        {
            this.loadLogo();
            this.buildDeck();
            this.buildBuildings();
            this.buildBluffStore();
            this.buildParks();
            this.buildStreetFurniture();
            this.buildMountainSign();
            scene.add(this.group);
        },

        update : function(delta)
        {
            for (var i = 0; i < this.spinners.length; i++)
            {
                this.spinners[i].rotation.z += delta * 0.6;
            }
        },

        // height of the walkable city surface under (x, y), or -Infinity outside the city
        groundHeightAt : function(x, y)
        {
            if (Math.abs(x) <= HALF && Math.abs(y) <= HALF) return DECK_Z;
            // bridge out of the east gate
            if (x > HALF && x <= HALF + 32 && Math.abs(y) <= STREET) return DECK_Z;
            return -Infinity;
        },

        // used by the player's jump / fall logic
        isGrounded : function(pos)
        {
            return (pos.z - 0.5) <= this.groundHeightAt(pos.x, pos.y);
        },

        random : function()
        {
            var x = Math.sin(this.seed++) * 10000;
            return x - Math.floor(x);
        },

        // ====================================================================
        //  Logo
        // ====================================================================

        loadLogo : function()
        {
            var img = new Image();
            img.onload = () =>
            {
                this.logo_image = img;
                this.logo_waiters.forEach((fn) => fn(img));
                this.logo_waiters = [];
            };
            img.src = "js/textures/bluff_logo.png";
        },

        // run fn(logoImage) now, or as soon as the logo has loaded
        withLogo : function(fn)
        {
            if (this.logo_image) fn(this.logo_image);
            else this.logo_waiters.push(fn);
        },

        // draw the logo into ctx, tinted with `color`
        drawLogo : function(ctx, img, x, y, size, color, alpha)
        {
            var tmp = document.createElement("canvas");
            tmp.width = tmp.height = Math.max(2, Math.round(size));
            var t = tmp.getContext("2d");
            t.drawImage(img, 0, 0, tmp.width, tmp.height);
            t.globalCompositeOperation = "source-in";
            t.fillStyle = color;
            t.fillRect(0, 0, tmp.width, tmp.height);
            ctx.save();
            ctx.globalAlpha = alpha === undefined ? 1 : alpha;
            ctx.drawImage(tmp, x, y);
            ctx.restore();
        },

        // ====================================================================
        //  Helpers
        // ====================================================================

        canvas : function(w, h)
        {
            var c = document.createElement("canvas");
            c.width = w; c.height = h;
            return c;
        },

        texture : function(canvas)
        {
            var tex = new THREE.CanvasTexture(canvas);
            tex.encoding = THREE.sRGBEncoding;
            tex.anisotropy = 8;
            return tex;
        },

        matte : function(color, extra)
        {
            return new THREE.MeshStandardMaterial(Object.assign(
                { color : new THREE.Color(color), roughness : 0.9, metalness : 0.0 }, extra || {}));
        },

        // axis aligned (optionally turned about Z) box standing on zBase
        box : function(w, d, h, x, y, zBase, material, collide, rotZ)
        {
            var mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(w, d, h), material);
            mesh.position.set(x, y, zBase + h / 2);
            mesh.rotation.z = rotZ || 0;
            this.group.add(mesh);
            if (collide) this.collider(w, d, h, mesh.position, mesh.quaternion);
            return mesh;
        },

        collider : function(w, d, h, position, quaternion)
        {
            var shape = new Physics.ammo.btBoxShape(new Physics.ammo.btVector3(w / 2, d / 2, h / 2));
            return Physics.createRigidbody(null, shape, 0, position, quaternion || new THREE.Quaternion());
        },

        // upright plane whose face looks along (sin phi, -cos phi):
        // phi = 0 faces south, PI/2 east, PI north, -PI/2 west
        wallPlane : function(w, h, material, x, y, z, phi)
        {
            var mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(w, h), material);
            mesh.position.set(x, y, z);
            mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi)
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
            this.group.add(mesh);
            return mesh;
        },

        // flat plane facing up
        floorPlane : function(w, d, material, x, y, z)
        {
            var mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(w, d), material);
            mesh.position.set(x, y, z);
            this.group.add(mesh);
            return mesh;
        },

        // ====================================================================
        //  Ground
        // ====================================================================

        buildDeck : function()
        {
            var S = 2048, size = HALF * 2;
            var cv = this.canvas(S, S), ctx = cv.getContext("2d");
            var px = (v) => v / size * S;                       // world length -> pixels
            var X = (x) => (x + HALF) / size * S;                // world x -> canvas x
            var Y = (y) => (HALF - y) / size * S;                // world y -> canvas y
            var rect = (x0, y0, x1, y1) => ctx.fillRect(X(x0), Y(y1), px(x1 - x0), px(y1 - y0));

            // pavement with paving joints
            ctx.fillStyle = C.pavement;
            ctx.fillRect(0, 0, S, S);
            ctx.strokeStyle = "rgba(0,0,0,0.10)";
            ctx.lineWidth = 1;
            for (var i = 0; i <= size; i += 2)
            {
                ctx.beginPath(); ctx.moveTo(px(i), 0); ctx.lineTo(px(i), S); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, px(i)); ctx.lineTo(S, px(i)); ctx.stroke();
            }
            // speckle
            for (var n = 0; n < 9000; n++)
            {
                ctx.fillStyle = "rgba(0,0,0," + (0.03 + this.random() * 0.05) + ")";
                ctx.fillRect(this.random() * S, this.random() * S, 2, 2);
            }

            // streets
            ctx.fillStyle = C.asphalt;
            rect(-STREET, -HALF, STREET, 36);          // main street, south gate to the Bluff plaza
            rect(-HALF, -STREET, HALF, STREET);        // cross street

            // lane dashes
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            for (var d = -HALF + 2; d < HALF; d += 5)
            {
                if (Math.abs(d + 1) > 11)
                {
                    if (d < 30) rect(-0.12, d, 0.12, d + 2.4);
                    rect(d, -0.12, d + 2.4, 0.12);
                }
            }
            // crosswalks around the roundabout and in front of the store
            var stripes = (horizontal, a, b) =>
            {
                for (var s = -STREET + 0.4; s < STREET - 0.3; s += 1.0)
                {
                    if (horizontal) rect(a, s, b, s + 0.5);
                    else rect(s, a, s + 0.5, b);
                }
            };
            stripes(false, 12, 14.2); stripes(false, -14.2, -12);
            stripes(true, 12, 14.2); stripes(true, -14.2, -12);
            stripes(false, 32, 34.5);

            // Bluff plaza: dark stone in front of the store
            ctx.fillStyle = "#3a3a3c";
            rect(-22, 36, 22, 42);

            // roundabout: the ring from the logo, with the logo inside it
            ctx.fillStyle = C.asphalt;
            ctx.beginPath(); ctx.arc(X(0), Y(0), px(10.5), 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = C.ink;
            ctx.beginPath(); ctx.arc(X(0), Y(0), px(7), 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = C.white;
            ctx.lineWidth = px(0.45);
            ctx.beginPath(); ctx.arc(X(0), Y(0), px(7), 0, Math.PI * 2); ctx.stroke();

            var tex = this.texture(cv);
            this.withLogo((img) =>
            {
                this.drawLogo(ctx, img, X(-5.6), Y(5.6), px(11.2), C.white, 0.95);
                tex.needsUpdate = true;
            });

            // slab: the plateau the city stands on
            var thickness = 30;
            var side = this.matte("#6f6a62");
            var top = new THREE.MeshStandardMaterial({ map : tex, roughness : 0.95 });
            var slab = this.box(size, size, thickness, 0, 0, DECK_Z - thickness,
                                [side, side, side, side, top, side], true);
            slab.name = "CityDeck";

            // bridge out of the east gate to the hillside
            var road = this.matte(C.asphalt);
            this.box(34, STREET * 2, 2, HALF + 16, 0, DECK_Z - 2, [side, side, side, side, road, side], true);
            this.box(34, 0.4, 1.0, HALF + 16, STREET + 0.2, DECK_Z, side, true);
            this.box(34, 0.4, 1.0, HALF + 16, -STREET - 0.2, DECK_Z, side, true);

            // parapet around the plateau, open at the east gate
            var wall = this.matte(C.charcoal);
            var t = 0.6, h = 1.3, e = HALF - t / 2;
            this.box(size, t, h, 0, e, DECK_Z, wall, true);
            this.box(size, t, h, 0, -e, DECK_Z, wall, true);
            this.box(t, size, h, -e, 0, DECK_Z, wall, true);
            var seg = HALF - STREET;
            this.box(t, seg, h, e, STREET + seg / 2, DECK_Z, wall, true);
            this.box(t, seg, h, e, -STREET - seg / 2, DECK_Z, wall, true);
            // gate posts
            this.box(1.2, 1.2, 5, e, STREET + 0.6, DECK_Z, wall, true);
            this.box(1.2, 1.2, 5, e, -STREET - 0.6, DECK_Z, wall, true);
        },

        // ====================================================================
        //  Buildings
        // ====================================================================

        window_textures : {},

        // one window bay, tiled across a facade
        windowTexture : function(wall, repeatX, repeatY)
        {
            var key = wall;
            if (!this.window_textures[key])
            {
                var cv = this.canvas(128, 160), ctx = cv.getContext("2d");
                ctx.fillStyle = wall;
                ctx.fillRect(0, 0, 128, 160);
                // floor line
                ctx.fillStyle = "rgba(0,0,0,0.18)";
                ctx.fillRect(0, 154, 128, 6);
                // window
                ctx.fillStyle = "rgba(0,0,0,0.55)";
                ctx.fillRect(26, 30, 76, 96);
                ctx.fillStyle = C.glass;
                ctx.fillRect(30, 34, 68, 88);
                ctx.fillStyle = "rgba(255,255,255,0.10)";
                ctx.beginPath(); ctx.moveTo(30, 122); ctx.lineTo(70, 34); ctx.lineTo(98, 34); ctx.lineTo(58, 122); ctx.fill();
                ctx.fillStyle = "rgba(0,0,0,0.6)";
                ctx.fillRect(62, 34, 4, 88);
                // sill
                ctx.fillStyle = "rgba(255,255,255,0.25)";
                ctx.fillRect(22, 126, 84, 5);
                this.window_textures[key] = cv;
            }
            var tex = this.texture(this.window_textures[key]);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(repeatX, repeatY);
            return tex;
        },

        // shop front: glass, a door in the middle, a plinth
        storefrontTexture : function(w, wall, frame)
        {
            var cv = this.canvas(Math.min(1024, Math.round(w * 48)), 144), ctx = cv.getContext("2d");
            var W = cv.width, H = cv.height, u = W / w;
            ctx.fillStyle = wall;
            ctx.fillRect(0, 0, W, H);
            // glass
            var grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#31434f"); grad.addColorStop(1, "#131b21");
            ctx.fillStyle = grad;
            ctx.fillRect(u * 0.5, 14, W - u, H - 34);
            // reflections
            ctx.fillStyle = "rgba(255,255,255,0.08)";
            for (var x = u; x < W - u; x += u * 2.3)
            {
                ctx.beginPath(); ctx.moveTo(x, H - 20); ctx.lineTo(x + u * 0.9, 14); ctx.lineTo(x + u * 1.5, 14); ctx.lineTo(x + u * 0.6, H - 20); ctx.fill();
            }
            // mullions
            ctx.fillStyle = frame;
            for (var m = u * 0.5; m <= W - u * 0.5 + 1; m += (W - u) / Math.max(2, Math.round(w / 3)))
            {
                ctx.fillRect(m - 3, 14, 6, H - 34);
            }
            ctx.fillRect(u * 0.5, 10, W - u, 6);
            // door
            var dw = u * 1.5;
            ctx.fillStyle = frame;
            ctx.fillRect(W / 2 - dw / 2 - 5, 22, dw + 10, H - 22);
            ctx.fillStyle = "#0d1216";
            ctx.fillRect(W / 2 - dw / 2, 28, dw, H - 28);
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillRect(W / 2 + dw / 2 - 12, H * 0.55, 4, 22);
            return this.texture(cv);
        },

        signTexture : function(text, bg, fg, withLogo)
        {
            var cv = this.canvas(768, 128), ctx = cv.getContext("2d");
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, 768, 128);
            ctx.strokeStyle = fg; ctx.lineWidth = 4;
            ctx.strokeRect(6, 6, 756, 116);
            ctx.fillStyle = fg;
            ctx.font = "900 78px 'Arial Black', Impact, 'Helvetica Neue', Arial, sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            var tex = this.texture(cv);
            if (withLogo)
            {
                ctx.fillText(text, 384 + 56, 68, 560);
                var tw = Math.min(560, ctx.measureText(text).width);
                this.withLogo((img) =>
                {
                    this.drawLogo(ctx, img, 384 + 56 - tw / 2 - 124, 8, 112, fg);
                    tex.needsUpdate = true;
                });
            } else
            {
                ctx.fillText(text, 384, 68, 700);
            }
            return tex;
        },

        // a building whose front looks along (sin phi, -cos phi), centred on (x, y)
        building : function(o)
        {
            var phi = o.phi, w = o.w, d = o.d || DEPTH;
            var floors = o.floors, h = floors * FLOOR;
            var nx = Math.sin(phi), ny = -Math.cos(phi);      // front direction
            var rx = Math.cos(phi), ry = Math.sin(phi);       // along the front
            var z0 = DECK_Z, e = 0.03;

            // body
            this.box(w, d, h, o.x, o.y, z0, this.matte(o.wall), true, phi);
            // roof and parapet lip
            this.box(w + 0.3, d + 0.3, 0.35, o.x, o.y, z0 + h, this.matte(C.ink), false, phi);

            var bays = Math.max(1, Math.round(w / BAY)), side_bays = Math.max(1, Math.round(d / BAY));
            var win = (bx, by) => new THREE.MeshStandardMaterial({ map : this.windowTexture(o.wall, bx, by), roughness : 0.8 });

            // back and sides: windows all the way down
            this.wallPlane(w, h, win(bays, floors), o.x - nx * (d / 2 + e), o.y - ny * (d / 2 + e), z0 + h / 2, phi + Math.PI);
            this.wallPlane(d, h, win(side_bays, floors), o.x + rx * (w / 2 + e), o.y + ry * (w / 2 + e), z0 + h / 2, phi + Math.PI / 2);
            this.wallPlane(d, h, win(side_bays, floors), o.x - rx * (w / 2 + e), o.y - ry * (w / 2 + e), z0 + h / 2, phi - Math.PI / 2);

            // front: shop or ground-floor windows, then windows above
            var fx = o.x + nx * (d / 2 + e), fy = o.y + ny * (d / 2 + e);
            if (floors > 1)
            {
                this.wallPlane(w, h - FLOOR, win(bays, floors - 1), fx, fy, z0 + FLOOR + (h - FLOOR) / 2, phi);
            }
            if (o.shop)
            {
                var shop = o.shop;
                this.wallPlane(w, FLOOR, new THREE.MeshStandardMaterial(
                    { map : this.storefrontTexture(w, o.wall, shop.fg), roughness : 0.35, metalness : 0.1 }),
                    fx, fy, z0 + FLOOR / 2, phi);
                // sign board
                var sw = Math.min(w * 0.82, 11), sh = sw / 6;
                var sx = o.x + nx * (d / 2 + 0.25), sy = o.y + ny * (d / 2 + 0.25);
                this.box(sw + 0.2, 0.3, sh + 0.2, sx - nx * 0.12, sy - ny * 0.12, z0 + FLOOR - 0.1, this.matte(C.ink), false, phi);
                this.wallPlane(sw, sh, new THREE.MeshBasicMaterial({ map : this.signTexture(shop.name, shop.bg, shop.fg, false) }),
                    sx + nx * 0.05, sy + ny * 0.05, z0 + FLOOR - 0.1 + (sh + 0.2) / 2, phi);
                // awning
                this.box(w * 0.9, 1.3, 0.12, o.x + nx * (d / 2 + 0.65), o.y + ny * (d / 2 + 0.65), z0 + FLOOR - 0.45,
                    this.matte(shop.awning || shop.bg), false, phi);
            } else
            {
                this.wallPlane(w, FLOOR, win(bays, 1), fx, fy, z0 + FLOOR / 2, phi);
            }
        },

        buildBuildings : function()
        {
            var walls = [C.charcoal, C.white, C.concrete, "#3a3a3c", "#d8d4cb", "#8e8a82", "#1c1c1e", "#a39d92"];
            var shops =
            [
                { name : "CAFE NOIR",   bg : "#141414", fg : "#f2f0ea" },
                { name : "VINYL",       bg : "#f2f0ea", fg : "#141414" },
                { name : "KICKS",       bg : "#e4472b", fg : "#ffffff" },
                { name : "24/7 MARKET", bg : "#1f6f4a", fg : "#ffffff" },
                { name : "BARBER",      bg : "#1b2a5c", fg : "#ffffff" },
                { name : "ARCADE",      bg : "#5b2a86", fg : "#ffe14d" },
                { name : "BOOKS",       bg : "#6b4a2b", fg : "#f2e6d0" },
                { name : "PIZZA",       bg : "#c22a1e", fg : "#ffe9b0" },
                { name : "SKATE SHOP",  bg : "#141414", fg : "#ffe14d" },
                { name : "TATTOO",      bg : "#262626", fg : "#e4472b" },
                { name : "RAMEN",       bg : "#f2f0ea", fg : "#c22a1e" },
                { name : "BAKERY",      bg : "#e8c98f", fg : "#3a2a18" },
                { name : "THRIFT",      bg : "#2f6f7a", fg : "#ffffff" },
                { name : "PHARMACY",    bg : "#ffffff", fg : "#1f8f4a" },
                { name : "FLOWERS",     bg : "#d86a8a", fg : "#ffffff" },
                { name : "GALLERY",     bg : "#f2f0ea", fg : "#262626" },
            ];
            var shop_i = 0, count = 0;

            var lot = (x, y, w, phi) =>
            {
                var o = { x : x, y : y, w : w - 0.6, phi : phi };
                o.floors = 2 + Math.floor(this.random() * 4);
                o.wall = walls[Math.floor(this.random() * walls.length)];
                // two out of three buildings have a shop on the ground floor
                if (count % 3 != 2) { o.shop = shops[shop_i % shops.length]; shop_i++; }
                count++;
                this.building(o);
            };

            var c = FRONT + DEPTH / 2;       // building centre line, measured from the street centre
            var E = Math.PI / 2, W = -Math.PI / 2, N = Math.PI, S = 0;

            // along the main street (fronts face the street)
            var main = [[-58.75, 14.5], [-44.25, 14.5], [-29.75, 14.5], [-15.25, 14.5], [15, 14], [29, 14]];
            main.forEach((m) =>
            {
                lot(-c, m[0], m[1], E);      // west side, faces east
                lot(c, m[0], m[1], W);       // east side, faces west
            });

            // taller blocks behind the shops in the two southern quarters, for a skyline
            [-1, 1].forEach((sx) =>
            {
                [[33, -34], [55, -34], [33, -56], [55, -56]].forEach((t, i) =>
                {
                    this.building({ x : sx * t[0], y : t[1], w : 17, d : 17, phi : i < 2 ? N : S,
                        floors : 5 + Math.floor(this.random() * 5),
                        wall : walls[Math.floor(this.random() * walls.length)] });
                });
            });

            // along the cross street
            var cross = [[29.3, 14.6], [43.9, 14.6], [58.5, 14.6]];
            cross.forEach((m) =>
            {
                lot(m[0], c, m[1], S);       // north side, faces south
                lot(-m[0], c, m[1], S);
                lot(m[0], -c, m[1], N);      // south side, faces north
                lot(-m[0], -c, m[1], N);
            });
        },

        // ====================================================================
        //  Bluff store: the flagship at the top of the main street. You can walk in.
        // ====================================================================

        buildBluffStore : function()
        {
            var w = 34, d = 20, h = 9, cx = 0, cy = 53, z0 = DECK_Z, t = 0.6;
            var front_y = cy - d / 2, back_y = cy + d / 2;
            var black = this.matte("#0e0e0f", { roughness : 0.6 });
            var inner = this.matte("#8f8c86");
            var door = 5;                                    // doorway width

            // walls (each one is solid, so the inside is a real room)
            this.box(w, t, h, cx, back_y - t / 2, z0, black, true);                       // back
            this.box(t, d, h, cx - w / 2 + t / 2, cy, z0, black, true);                   // west
            this.box(t, d, h, cx + w / 2 - t / 2, cy, z0, black, true);                   // east
            var seg = (w - door) / 2;
            this.box(seg, t, h, cx - door / 2 - seg / 2, front_y + t / 2, z0, black, true);   // front, left of the door
            this.box(seg, t, h, cx + door / 2 + seg / 2, front_y + t / 2, z0, black, true);   // front, right of the door
            this.box(door, t, h - 3.6, cx, front_y + t / 2, z0 + 3.6, black, false);          // above the door
            this.box(w + 0.6, d + 0.6, 0.5, cx, cy, z0 + h, this.matte(C.ink), false);        // roof

            // shop windows either side of the door
            var glass = new THREE.MeshStandardMaterial(
                { color : 0x22323c, roughness : 0.15, metalness : 0.3, transparent : true, opacity : 0.55 });
            [-1, 1].forEach((s) =>
            {
                this.wallPlane(seg - 3, 3.2, glass, cx + s * (door / 2 + seg / 2), front_y - 0.02, z0 + 2.1, 0);
            });

            // white interior
            this.floorPlane(w - 2 * t, d - 2 * t, this.matte("#55534f", { roughness : 0.5 }), cx, cy, z0 + 0.03);
            this.wallPlane(w - 2 * t, h, inner, cx, back_y - t - 0.02, z0 + h / 2, 0);
            this.wallPlane(d - 2 * t, h, inner, cx - w / 2 + t + 0.02, cy, z0 + h / 2, Math.PI / 2);
            this.wallPlane(d - 2 * t, h, inner, cx + w / 2 - t - 0.02, cy, z0 + h / 2, -Math.PI / 2);
            var ceiling = this.floorPlane(w - 2 * t, d - 2 * t, this.matte("#77746f"), cx, cy, z0 + h - 0.02);
            ceiling.rotation.x = Math.PI;

            // logo: big on the facade, on the back wall inside, and on a roof sign
            var logoMaterial = (color, bg) =>
            {
                var cv = this.canvas(512, 512), ctx = cv.getContext("2d");
                if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 512); }
                var tex = this.texture(cv);
                this.withLogo((img) => { this.drawLogo(ctx, img, 16, 16, 480, color); tex.needsUpdate = true; });
                return new THREE.MeshBasicMaterial({ map : tex, transparent : !bg, side : THREE.DoubleSide });
            };
            this.wallPlane(4.6, 4.6, logoMaterial("#ffffff"), cx - 11.5, front_y - 0.04, z0 + 6.4, 0);
            this.wallPlane(4.6, 4.6, logoMaterial("#ffffff"), cx + 11.5, front_y - 0.04, z0 + 6.4, 0);
            this.wallPlane(6.5, 6.5, logoMaterial("#141414"), cx, back_y - t - 0.05, z0 + 4.8, 0);

            // name over the door
            this.wallPlane(15, 2.5, new THREE.MeshBasicMaterial({ map : this.signTexture("BLUFF", "#0e0e0f", "#ffffff", true) }),
                cx, front_y - 0.05, z0 + 5.6, 0);

            // roof sign: the logo on a black disc, turning slowly
            this.box(0.5, 0.5, 2.2, cx, cy - 6, z0 + h + 0.5, this.matte(C.ink), false);
            var disc = new THREE.Mesh(new THREE.CylinderBufferGeometry(4.2, 4.2, 0.4, 48), this.matte("#0e0e0f"));
            var sign = new THREE.Group();
            sign.position.set(cx, cy - 6, z0 + h + 6.6);
            sign.add(disc);
            [1, -1].forEach((s) =>
            {
                var face = new THREE.Mesh(new THREE.PlaneBufferGeometry(7.4, 7.4), logoMaterial("#ffffff"));
                face.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), s > 0 ? 0 : Math.PI)
                    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
                face.position.y = -0.22 * s;
                sign.add(face);
            });
            this.group.add(sign);
            this.spinners.push(sign);

            // display tables with the bag on them
            var table = this.matte("#141414");
            var spots = [[-9, 50], [9, 50], [-9, 57], [9, 57], [0, 55]];
            spots.forEach((p, i) =>
            {
                this.box(3, 1.6, 0.9, cx + p[0], p[1], z0, table, true);
                var bag = Bag.create();
                bag.scale.setScalar(0.045);
                bag.rotation.x = Math.PI / 2;                 // stand the loop upright
                var holder = new THREE.Group();
                holder.position.set(cx + p[0], p[1], z0 + 1.75);
                holder.rotation.z = i * 0.9;
                holder.add(bag);
                this.group.add(holder);
                if (i == 4) this.spinners.push(holder);
            });

            // warm light inside so the room reads from the street
            var lamp = new THREE.PointLight(0xfff1d6, 0.5, 40, 2);
            lamp.position.set(cx, cy, z0 + h - 1.5);
            this.group.add(lamp);

            // one bag on a plinth out on the plaza
            this.box(1.6, 1.6, 1.2, -13, 39, z0, table, true);
            var plaza_bag = Bag.create();
            plaza_bag.scale.setScalar(0.05);
            plaza_bag.rotation.x = Math.PI / 2;
            var plaza_holder = new THREE.Group();
            plaza_holder.position.set(-13, 39, z0 + 2.2);
            plaza_holder.add(plaza_bag);
            this.group.add(plaza_holder);
            this.spinners.push(plaza_holder);
        },

        // ====================================================================
        //  Parks either side of the store: graffiti wall (west), trees (east)
        // ====================================================================

        graffitiTexture : function(w, h, big)
        {
            var cv = this.canvas(1024, Math.round(1024 * h / w)), ctx = cv.getContext("2d");
            var W = cv.width, H = cv.height;
            // concrete
            ctx.fillStyle = "#9a968e";
            ctx.fillRect(0, 0, W, H);
            for (var n = 0; n < 5000; n++)
            {
                ctx.fillStyle = "rgba(0,0,0," + (0.02 + this.random() * 0.07) + ")";
                ctx.fillRect(this.random() * W, this.random() * H, 3, 3);
            }
            // formwork joints
            ctx.fillStyle = "rgba(0,0,0,0.18)";
            for (var j = 1; j < 6; j++) ctx.fillRect(j * W / 6, 0, 2, H);

            // spray clouds
            var cloud = (x, y, r, color) =>
            {
                var g = ctx.createRadialGradient(x, y, 0, x, y, r);
                g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
                ctx.fillStyle = g;
                ctx.fillRect(x - r, y - r, r * 2, r * 2);
            };
            cloud(W * 0.5, H * 0.5, H * 0.75, "rgba(20,20,20,0.85)");
            cloud(W * 0.2, H * 0.55, H * 0.45, "rgba(228,71,43,0.55)");
            cloud(W * 0.82, H * 0.45, H * 0.5, "rgba(255,225,77,0.45)");

            // tags
            ctx.save();
            ctx.font = "900 " + Math.round(H * 0.3) + "px 'Arial Black', Impact, sans-serif";
            ctx.textBaseline = "middle"; ctx.textAlign = "center";
            ctx.lineJoin = "round";
            var tag = (text, x, y, rot, fill, stroke) =>
            {
                ctx.save();
                ctx.translate(x, y); ctx.rotate(rot); ctx.transform(1, 0, -0.18, 1, 0, 0);
                ctx.lineWidth = H * 0.045; ctx.strokeStyle = stroke; ctx.strokeText(text, 0, 0);
                ctx.fillStyle = fill; ctx.fillText(text, 0, 0);
                ctx.restore();
            };
            tag("BLUFF", W * 0.2, H * 0.52, -0.08, "#ffffff", "#141414");
            tag("WRLD", W * 0.82, H * 0.5, 0.06, "#ffe14d", "#141414");
            ctx.restore();

            // drips
            var drips = () =>
            {
                ctx.fillStyle = "rgba(255,255,255,0.9)";
                for (var k = 0; k < 9; k++)
                {
                    var dx = W * 0.4 + this.random() * W * 0.2, len = H * (0.08 + this.random() * 0.22);
                    ctx.fillRect(dx, H * 0.78, 4, len);
                    ctx.beginPath(); ctx.arc(dx + 2, H * 0.78 + len, 4, 0, Math.PI * 2); ctx.fill();
                }
            };

            var tex = this.texture(cv);
            this.withLogo((img) =>
            {
                var size = H * 0.92;
                // soft white halo, then the logo itself
                this.drawLogo(ctx, img, W / 2 - size / 2 - 6, H * 0.04 - 6, size + 12, "#141414", 0.9);
                this.drawLogo(ctx, img, W / 2 - size / 2, H * 0.04, size, "#ffffff", 1);
                drips();
                tex.needsUpdate = true;
            });
            return tex;
        },

        tree : function(x, y, scale)
        {
            var trunk = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.18 * scale, 0.26 * scale, 2.2 * scale, 8), this.matte("#3a2f28"));
            trunk.rotation.x = Math.PI / 2;
            trunk.position.set(x, y, DECK_Z + 1.1 * scale);
            this.group.add(trunk);
            var leaves = this.matte("#1f3d2b");
            [[1.7, 2.6], [1.3, 3.8], [0.8, 4.8]].forEach((l) =>
            {
                var blob = new THREE.Mesh(new THREE.IcosahedronBufferGeometry(l[0] * scale, 1), leaves);
                blob.position.set(x, y, DECK_Z + l[1] * scale);
                this.group.add(blob);
            });
            this.collider(0.6 * scale, 0.6 * scale, 4, new THREE.Vector3(x, y, DECK_Z + 2));
        },

        buildParks : function()
        {
            // west park: free-standing graffiti wall facing the plaza
            var w = 26, h = 6.5;
            this.box(w, 0.8, h, -43, 58, DECK_Z, this.matte("#8e8a82"), true);
            this.wallPlane(w, h, new THREE.MeshStandardMaterial({ map : this.graffitiTexture(w, h), roughness : 0.95 }),
                -43, 58 - 0.42, DECK_Z + h / 2, 0);
            this.tree(-60, 46, 1.2);
            this.tree(-26, 44, 1.0);

            // a second, smaller piece on the side wall of the store's alley
            var w2 = 12, h2 = 4;
            this.wallPlane(w2, h2, new THREE.MeshStandardMaterial({ map : this.graffitiTexture(w2, h2), roughness : 0.95 }),
                17.05, 53, DECK_Z + 2.4, Math.PI / 2);

            // east park: trees and benches
            var spots = [[30, 46], [40, 60], [52, 48], [62, 62], [46, 54], [28, 62], [60, 44]];
            spots.forEach((p, i) => this.tree(p[0], p[1], 0.9 + (i % 3) * 0.25));
            var bench = this.matte(C.charcoal);
            [[36, 52], [54, 56]].forEach((p) =>
            {
                this.box(3.2, 0.9, 0.5, p[0], p[1], DECK_Z, bench, true);
            });
        },

        // ====================================================================
        //  Street lamps
        // ====================================================================

        buildStreetFurniture : function()
        {
            var pole = this.matte(C.ink);
            var bulb = new THREE.MeshBasicMaterial({ color : 0xfff1c9 });
            var lamp = (x, y, dx, dy) =>
            {
                this.box(0.16, 0.16, 5.2, x, y, DECK_Z, pole, false);
                this.box(Math.abs(dx) * 1.2 + 0.14, Math.abs(dy) * 1.2 + 0.14, 0.12, x + dx * 0.6, y + dy * 0.6, DECK_Z + 5.2, pole, false);
                var b = new THREE.Mesh(new THREE.SphereBufferGeometry(0.22, 12, 8), bulb);
                b.position.set(x + dx * 1.2, y + dy * 1.2, DECK_Z + 5.1);
                this.group.add(b);
            };
            for (var y = -60; y <= 30; y += 18)
            {
                if (Math.abs(y) < 12) continue;
                lamp(-STREET - 0.8, y, 1, 0);
                if (y + 9 < 34) lamp(STREET + 0.8, y + 9, -1, 0);
            }
            for (var x = -60; x <= 60; x += 18)
            {
                if (Math.abs(x) < 12) continue;
                lamp(x, STREET + 0.8, 0, -1);
                lamp(x + 9, -STREET - 0.8, 0, 1);
            }
        },

        // ====================================================================
        //  The logo on the mountain south-east of the city
        // ====================================================================

        buildMountainSign : function()
        {
            var x = 240, y = -120, base = 62, size = 96;
            var phi = Math.atan2(-x, y);          // face the city centre
            var cv = this.canvas(1024, 1024), ctx = cv.getContext("2d");
            var tex = this.texture(cv);
            // charcoal panel with the white logo, like the logo artwork itself
            ctx.fillStyle = C.charcoal;
            ctx.fillRect(0, 0, 1024, 1024);
            this.withLogo((img) => { this.drawLogo(ctx, img, 60, 60, 904, "#ffffff"); tex.needsUpdate = true; });
            var sign = this.wallPlane(size, size, new THREE.MeshBasicMaterial(
                { map : tex, side : THREE.DoubleSide }), x, y, base + size / 2, phi);
            // lean back against the slope
            sign.rotateX(-0.22);

            // support posts
            var post = this.matte(C.ink);
            var rx = Math.cos(phi), ry = Math.sin(phi), nx = Math.sin(phi), ny = -Math.cos(phi);
            [-0.3, 0, 0.3].forEach((s) =>
            {
                this.box(1.2, 1.2, size * 0.75, x + rx * size * s - nx * 6, y + ry * size * s - ny * 6, base - 8, post, false);
            });
        },
    };

    return City;
});
