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
define(["three", "scene", "physics", "bag", "gltfLoader"], (THREE, scene, Physics, Bag, GLTFLoader) =>
{
    var HALF = 70;              // the city deck spans -HALF..HALF in x and y
    var DECK_Z = 23;            // height of the streets (just above the valley floor's highest point)
    var STREET = 4;             // half width of a street
    var FRONT = 7;              // distance from a street's centre line to the shop fronts
    var DEPTH = 14;             // building depth
    var FLOOR = 3;              // floor height
    var BAY = 2.4;              // width of one window bay
    // The city is modelled in "plan units" (a floor is 3 high) and then shrunk by K so that
    // doors, counters and bags are the right size next to the ~1 unit tall player.
    var K = 0.62;
    var BRIDGE = 100 / K - HALF;   // plan length of the east bridge (it lands on the hillside at world x = 100)

    // palette taken from the logo: charcoal and white, with concrete in between
    var C =
    {
        charcoal : "#262626", ink : "#141414", white : "#f2f0ea", concrete : "#b9b6ae",
        pavement : "#c9c6be", asphalt : "#2f2f31", glass : "#1d2a33", glass_lit : "#f5d98a",
        accent : "#e4472b",
        // brand palette from bluff.508.world
        washed : "#12110F", orange : "#ff4e00", clay : "#B6521F", olive : "#6E6B4E",
        stone : "#9A968B", beige : "#D8CFBE", cream : "#e8e3d8", hairline : "#2e2b24",
    };
    var FONT_MARK = "'Permanent Marker', 'Arial Black', Impact, sans-serif";
    var FONT_MONO = "'IBM Plex Mono', 'Courier New', monospace";
    // the bag's colourways
    var BAG_COLOURS =
    [
        { name : "WASHED BLACK", color : "#12110F" },
        { name : "BURNT CLAY",   color : "#B6521F" },
        { name : "OLIVE GREEN",  color : "#6E6B4E" },
        { name : "STONE GREY",   color : "#9A968B" },
        { name : "DUST BEIGE",   color : "#D8CFBE" },
        // extra colourways for the game world, taken from the paintings in the store
        { name : "RUG RED",      color : "#A12D26" },
        { name : "ALPINE BLUE",  color : "#3E6FA3" },
        { name : "MEADOW",       color : "#6F9A3B" },
        { name : "SUNSET",       color : "#E8A03A" },
        { name : "DUSK VIOLET",  color : "#56467F" },
    ];

    var City =
    {
        HALF : HALF,
        DECK_Z : DECK_Z,
        SCALE : K,
        spawn : new THREE.Vector3(0, -30 * K, DECK_Z + 2),
        group : new THREE.Group(),      // everything in plan units, scaled by K
        far : new THREE.Group(),        // things placed directly in world units (the mountain sign)
        parent : null,
        spinners : [],
        logo_image : null,
        logo_waiters : [],
        seed : 7,
        clock : 0,
        plan_pos : new THREE.Vector3(),
        npcs : [],
        talking : null,
        near_booth : false,
        booth : { x : -27, y : 48 },
        park : { cx : 45, cy : 46, pond_r : 5, path_y : 46 },
        game :
        {
            running : false, score : 0, time : 0, limit : 60, total : 10, result : null, result_until : 0, tokens : [],
            spots : [[-20, 40], [-7, 38], [7, 38], [20, 40], [30, 46], [45, 36.5], [59, 46], [45, 55.5], [-43, 56], [-58, 46]],
        },

        init : function()
        {
            this.loadLogo();
            this.loadCrescent();
            this.buildDeck();
            this.buildBuildings();
            this.buildBluffStore();
            this.buildParks();
            this.buildBooth();
            this.buildHud();
            this.buildStreetFurniture();
            this.parent = this.far;
            this.buildMountainSign();
            this.parent = null;
            // shrink the plan about the street level so the streets stay at DECK_Z
            this.group.scale.setScalar(K);
            this.group.position.z = DECK_Z * (1 - K);
            scene.add(this.group);
            scene.add(this.far);
        },

        update : function(delta, player)
        {
            this.clock += delta;
            for (var i = 0; i < this.spinners.length; i++)
            {
                this.spinners[i].rotation.z += delta * 0.6;
            }
            if (!player || !player.initialized) return;
            // player position in plan units
            var wp = player.threeObj.position;
            // safety net: anyone who ends up below street level around the plateau
            // (under the city or in the lake) is put back on the main street
            var reach = HALF * K + 25;
            if (wp.z < DECK_Z - 3 && Math.abs(wp.x) < reach && Math.abs(wp.y) < reach) this.respawn(player);
            this.player = player;
            var pos = this.plan_pos.set(wp.x / K, wp.y / K, (wp.z - DECK_Z) / K + DECK_Z);

            this.updateGame(delta, pos);
            var talking = this.updatePeople(delta, pos);

            // bottom message: booth prompt first, then whoever is speaking
            var dx = pos.x - this.booth.x, dy = pos.y - (this.booth.y - 3);
            this.near_booth = dx * dx + dy * dy < 36 && Math.abs(pos.z - DECK_Z) < 3;
            if (this.near_booth && !this.game.running)
            {
                this.show(this.hud_msg, "<span style=\"color:#ff4e00\">PRESS E</span> &nbsp;TO PLAY BLUFF RUN &nbsp;•&nbsp; " +
                    this.game.total + " logos, " + this.game.limit + " seconds");
            } else if (talking && !this.game.running)
            {
                this.show(this.hud_msg, "<span style=\"color:#ff4e00\">" + talking.name.toUpperCase() + "</span> &nbsp; " + talking.lines[talking.line]);
            } else
            {
                this.show(this.hud_msg, null);
            }
        },

        // put the player back on the main street
        respawn : function(player)
        {
            var body = player.rigidbody;
            if (!body || !body.getWorldTransform) return;
            var off = player.rigidbody_offset;
            var t = body.getWorldTransform();
            t.setOrigin(new Physics.ammo.btVector3(this.spawn.x + off.x, this.spawn.y + off.y, this.spawn.z + off.z));
            body.setWorldTransform(t);
            body.getMotionState().setWorldTransform(t);
            body.setLinearVelocity(new Physics.ammo.btVector3(0, 0, 0));
        },

        // height of the walkable city surface under (x, y), or -Infinity outside the city
        groundHeightAt : function(x, y)
        {
            x /= K; y /= K;     // world -> plan units
            if (Math.abs(x) <= HALF && Math.abs(y) <= HALF) return DECK_Z;
            // bridge out of the east gate
            if (x > HALF && x <= HALF + BRIDGE && Math.abs(y) <= STREET) return DECK_Z;
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
            (this.parent || this.group).add(mesh);
            if (collide) this.collider(w, d, h, mesh.position, mesh.quaternion);
            return mesh;
        },

        collider : function(w, d, h, position, quaternion)
        {
            // plan units -> world units
            var shape = new Physics.ammo.btBoxShape(new Physics.ammo.btVector3(w * K / 2, d * K / 2, h * K / 2));
            var world = new THREE.Vector3(position.x * K, position.y * K, (position.z - DECK_Z) * K + DECK_Z);
            return Physics.createRigidbody(null, shape, 0, world, quaternion || new THREE.Quaternion());
        },

        // upright plane whose face looks along (sin phi, -cos phi):
        // phi = 0 faces south, PI/2 east, PI north, -PI/2 west
        wallPlane : function(w, h, material, x, y, z, phi)
        {
            var mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(w, h), material);
            mesh.position.set(x, y, z);
            mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi)
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
            (this.parent || this.group).add(mesh);
            return mesh;
        },

        // flat plane facing up
        floorPlane : function(w, d, material, x, y, z)
        {
            var mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(w, d), material);
            mesh.position.set(x, y, z);
            (this.parent || this.group).add(mesh);
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

            // Bluff Park: lawn, paths and the paved ring round the pond
            var P = this.park;
            ctx.fillStyle = "#4f6f3e";
            rect(21.5, 23, 69.4, 69.4);
            for (var gn = 0; gn < 14000; gn++)
            {
                ctx.fillStyle = this.random() < 0.5 ? "rgba(20,50,20,0.25)" : "rgba(150,190,90,0.18)";
                ctx.fillRect(X(21.5 + this.random() * 47.9), Y(23 + this.random() * 46.4), 2, 3);
            }
            ctx.fillStyle = C.beige;
            rect(18, P.path_y - 1.7, 69.4, P.path_y + 1.7);
            rect(P.cx - 1.7, 23, P.cx + 1.7, 69.4);
            ctx.beginPath(); ctx.arc(X(P.cx), Y(P.cy), px(P.pond_r + 5.2), 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = C.clay; ctx.lineWidth = px(0.3);
            ctx.beginPath(); ctx.arc(X(P.cx), Y(P.cy), px(P.pond_r + 5.2), 0, Math.PI * 2); ctx.stroke();

            // Bluff plaza: washed-black stone in front of the store, with an orange runner to the door
            ctx.fillStyle = "#1c1a17";
            rect(-22, 36, 22, 43);
            ctx.fillStyle = C.orange;
            rect(-2.2, 36, 2.2, 43);
            ctx.fillStyle = "rgba(232,227,216,0.5)";
            rect(-22, 35.8, 22, 36); rect(-2.45, 36, -2.2, 43); rect(2.2, 36, 2.45, 43);

            // start circle in front of the game booth
            ctx.strokeStyle = C.orange; ctx.lineWidth = px(0.4);
            ctx.beginPath(); ctx.arc(X(this.booth.x), Y(this.booth.y - 3.4), px(2.6), 0, Math.PI * 2); ctx.stroke();

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
            var thickness = 42;
            var side = this.matte("#6f6a62");
            var top = new THREE.MeshStandardMaterial({ map : tex, roughness : 0.95 });
            var slab = this.box(size, size, thickness, 0, 0, DECK_Z - thickness,
                                [side, side, side, side, top, side], true);
            slab.name = "CityDeck";

            // bridge out of the east gate to the hillside
            var road = this.matte(C.asphalt);
            this.box(BRIDGE + 2, STREET * 2, 2, HALF + BRIDGE / 2, 0, DECK_Z - 2, [side, side, side, side, road, side], true);
            this.box(BRIDGE, 0.4, 1.0, HALF + BRIDGE / 2, STREET + 0.2, DECK_Z, side, true);
            this.box(BRIDGE, 0.4, 1.0, HALF + BRIDGE / 2, -STREET - 0.2, DECK_Z, side, true);
            for (var bp = 12; bp < BRIDGE - 6; bp += 16) this.box(1.4, STREET * 2 - 1, 40, HALF + bp, 0, DECK_Z - 42, side, false);

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
        //  Brand helpers (colours and type from bluff.508.world)
        // ====================================================================

        // run fn now, and again once the brand fonts have loaded, so text is redrawn in them
        onFonts : function(fn)
        {
            fn();
            if (document.fonts && document.fonts.load)
            {
                Promise.all([document.fonts.load("64px 'Permanent Marker'"), document.fonts.load("32px 'IBM Plex Mono'")])
                    .then(() => fn()).catch(() => {});
            }
        },

        // a texture whose drawing is repeated when fonts / the logo arrive
        drawnTexture : function(w, h, draw)
        {
            var cv = this.canvas(w, h), ctx = cv.getContext("2d");
            var tex = this.texture(cv);
            var redraw = () =>
            {
                ctx.clearRect(0, 0, w, h);
                draw(ctx, w, h, this.logo_image);
                tex.needsUpdate = true;
            };
            this.onFonts(redraw);
            if (!this.logo_image) this.withLogo(redraw);
            return tex;
        },

        // lit material in an exact brand colour
        brand : function(color, extra)
        {
            return new THREE.MeshStandardMaterial(Object.assign(
                { color : new THREE.Color(color).convertSRGBToLinear(), roughness : 0.85, metalness : 0.0 }, extra || {}));
        },

        // unlit, always-bright material (neon, light strips, signs)
        glow : function(color, extra)
        {
            return new THREE.MeshBasicMaterial(Object.assign(
                { color : new THREE.Color(color).convertSRGBToLinear() }, extra || {}));
        },

        // raw concrete from the brand site, optionally tinted
        concrete : function(repeatX, repeatY, tint)
        {
            var tex = new THREE.TextureLoader().load("js/textures/bluff_concrete.jpg");
            tex.encoding = THREE.sRGBEncoding;
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(repeatX || 1, repeatY || 1);
            tex.anisotropy = 8;
            return new THREE.MeshStandardMaterial({ map : tex, color : new THREE.Color(tint || "#ffffff").convertSRGBToLinear(), roughness : 0.9 });
        },

        glass : function(opacity)
        {
            return new THREE.MeshStandardMaterial(
            {
                color : new THREE.Color("#9fb4bd").convertSRGBToLinear(), roughness : 0.05, metalness : 0.2,
                transparent : true, opacity : opacity === undefined ? 0.16 : opacity,
                depthWrite : false, side : THREE.DoubleSide,
            });
        },

        // text sign: marker wordmark or mono label
        textMaterial : function(text, o)
        {
            o = o || {};
            var w = o.w || 1024, h = o.h || 256;
            var tex = this.drawnTexture(w, h, (ctx, W, H) =>
            {
                if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H); }
                ctx.fillStyle = o.fg || C.cream;
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.font = (o.mono ? "600 " : "") + Math.round(H * (o.size || 0.62)) + "px " + (o.mono ? FONT_MONO : FONT_MARK);
                ctx.fillText(text, W / 2, H * 0.54, W * 0.94);
            });
            return new THREE.MeshBasicMaterial({ map : tex, transparent : !o.bg, side : THREE.DoubleSide });
        },

        logoMaterial : function(color, bg)
        {
            var tex = this.drawnTexture(512, 512, (ctx, W, H, img) =>
            {
                if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
                if (img) this.drawLogo(ctx, img, 16, 16, 480, color);
            });
            return new THREE.MeshBasicMaterial({ map : tex, transparent : !bg, side : THREE.DoubleSide });
        },

        // ---- The Crescent: the real product model from the Bluff studio ----
        crescent : null,
        crescent_waiters : [],
        crescent_materials : {},
        CRESCENT_HEIGHT : 1.3136,       // model height in its own units, strap top included

        loadCrescent : function()
        {
            new THREE.GLTFLoader().load("js/models/crescent.glb", (gltf) =>
            {
                var model = gltf.scene;
                // a neutral grey copy of the fabric photo, so each colourway can tint it
                model.traverse((o) =>
                {
                    // the model ships without normals; lit materials need them
                    if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
                    if (o.isMesh && o.material.map && !this.crescent_fabric)
                    {
                        var img = o.material.map.image;
                        var cv = this.canvas(img.width, img.height), ctx = cv.getContext("2d");
                        ctx.drawImage(img, 0, 0);
                        var data = ctx.getImageData(0, 0, cv.width, cv.height), d = data.data, sum = 0;
                        for (var i = 0; i < d.length; i += 4)
                        {
                            var l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
                            d[i] = d[i + 1] = d[i + 2] = l;
                            sum += l;
                        }
                        var gain = 205 / (sum / (d.length / 4));       // lift the weave to a light grey
                        for (var k = 0; k < d.length; k += 4) d[k] = d[k + 1] = d[k + 2] = Math.min(255, d[k] * gain);
                        ctx.putImageData(data, 0, 0);
                        var tex = new THREE.CanvasTexture(cv);
                        tex.encoding = THREE.sRGBEncoding;
                        tex.flipY = o.material.map.flipY;
                        tex.wrapS = o.material.map.wrapS; tex.wrapT = o.material.map.wrapT;
                        this.crescent_fabric = tex;
                    }
                });
                this.crescent = model;
                this.crescent_waiters.forEach((fn) => fn());
                this.crescent_waiters = [];
            }, undefined, (error) => console.error("city.js: could not load the Crescent model", error));
        },

        // a copy of the Crescent in one colourway
        crescentCopy : function(color)
        {
            var mats = this.crescent_materials[color];
            if (!mats)
            {
                var base = new THREE.Color(color).convertSRGBToLinear();
                mats = this.crescent_materials[color] =
                {
                    fabric : new THREE.MeshStandardMaterial({ map : this.crescent_fabric, color : base, roughness : 0.9, side : THREE.DoubleSide }),
                    // the inside matches the outside, a shade deeper
                    lining : new THREE.MeshStandardMaterial({ color : base.clone().multiplyScalar(0.72), roughness : 0.9, side : THREE.DoubleSide }),
                    stitch : new THREE.MeshStandardMaterial({ color : base.clone().multiplyScalar(0.6), roughness : 0.9 }),
                    thread : new THREE.MeshStandardMaterial({ color : new THREE.Color(C.cream).convertSRGBToLinear(), roughness : 0.8 }),
                };
            }
            var copy = this.crescent.clone(true);
            copy.traverse((o) =>
            {
                if (!o.isMesh) return;
                var name = o.material.name || "";
                o.material = o.material.map ? mats.fabric : /lining/i.test(name) ? mats.lining : /stitch/i.test(name) ? mats.stitch : mats.thread;
            });
            return copy;
        },

        // a bag hanging / standing on display. (x, y, z) is where the top of its strap goes;
        // `scale` * 42 is its full height in plan units. With rotZ = 0 its front faces +X.
        displayBag : function(color, x, y, z, scale, rotZ, spin)
        {
            var holder = new THREE.Group();
            holder.position.set(x, y, z);
            holder.rotation.z = rotZ || 0;
            this.group.add(holder);
            if (spin) this.spinners.push(holder);

            var place = () =>
            {
                var s = scale * 42 / this.CRESCENT_HEIGHT;
                var bag = this.crescentCopy(color);
                bag.scale.setScalar(s);
                bag.rotation.x = Math.PI / 2;                    // model is Y-up: stand it on Z
                bag.position.z = -this.CRESCENT_HEIGHT * s;      // hang from the strap's top
                var turn = new THREE.Group();
                turn.rotation.z = Math.PI / 2;                   // front towards +X
                turn.add(bag);
                holder.add(turn);
            };
            if (this.crescent) place(); else this.crescent_waiters.push(place);
            return holder;
        },

        // glass case on a plinth with a bag inside
        vitrine : function(x, y, color, o)
        {
            o = o || {};
            var size = o.size || 1.15, plinth = o.plinth || 0.95, tall = o.tall || 1.45, z0 = DECK_Z;
            this.box(size, size, plinth, x, y, z0, this.brand(o.base || C.beige, { roughness : 0.6 }), true);
            this.box(size + 0.1, size + 0.1, 0.06, x, y, z0 + plinth, this.glow(C.orange), false);
            var caseMesh = this.box(size - 0.1, size - 0.1, tall, x, y, z0 + plinth + 0.06, this.glass(0.14), false);
            caseMesh.renderOrder = 2;
            this.box(size, size, 0.08, x, y, z0 + plinth + tall + 0.06, this.brand(C.washed), false);
            var scale = (tall - 0.3) / 42;
            this.displayBag(color, x, y, z0 + plinth + tall - 0.08, scale, o.rotZ || 0, o.spin);
            this.collider(size, size, plinth + tall, new THREE.Vector3(x, y, z0 + (plinth + tall) / 2));
        },

        // ====================================================================
        //  People
        // ====================================================================

        // simple stylised person, ~1.05 units tall, standing at (x, y) and facing phi
        person : function(o)
        {
            var g = new THREE.Group();
            var skin = this.brand(o.skin || "#b98a66", { roughness : 0.7 });
            var shirt = this.brand(o.shirt || C.washed);
            var pants = this.brand(o.pants || C.beige);
            var hair = this.brand(o.hair || "#1a1512");
            var part = (geo, mat, px, py, pz) =>
            {
                var m = new THREE.Mesh(geo, mat);
                m.position.set(px, py, pz);
                g.add(m);
                return m;
            };
            // legs and shoes
            [-0.075, 0.075].forEach((sx) =>
            {
                part(new THREE.BoxBufferGeometry(0.11, 0.12, 0.46), pants, sx, 0, 0.27);
                part(new THREE.BoxBufferGeometry(0.12, 0.2, 0.06), this.brand("#f1ede4"), sx, -0.03, 0.03);
            });
            // torso, arms
            part(new THREE.BoxBufferGeometry(0.3, 0.17, 0.38), shirt, 0, 0, 0.68);
            [-0.195, 0.195].forEach((sx) =>
            {
                part(new THREE.BoxBufferGeometry(0.085, 0.1, 0.16), shirt, sx, 0, 0.79);
                part(new THREE.BoxBufferGeometry(0.07, 0.08, 0.26), skin, sx, 0, 0.59);
            });
            // head
            var head = new THREE.Group();
            head.position.set(0, 0, 0.97);
            g.add(head);
            var skull = new THREE.Mesh(new THREE.SphereBufferGeometry(0.105, 16, 12), skin);
            head.add(skull);
            var cap = new THREE.Mesh(new THREE.SphereBufferGeometry(0.112, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
            cap.rotation.x = Math.PI / 2;     // dome up
            cap.position.set(0, 0.012, 0.012);
            head.add(cap);
            [-0.04, 0.04].forEach((sx) =>
            {
                var eye = new THREE.Mesh(new THREE.SphereBufferGeometry(0.014, 8, 6), this.brand("#0b0a08"));
                eye.position.set(sx, -0.098, 0.01);
                head.add(eye);
            });
            part(new THREE.CylinderBufferGeometry(0.04, 0.04, 0.06, 8), skin, 0, 0, 0.885).rotation.x = Math.PI / 2;

            // staff wear the bag
            if (o.bag)
            {
                var bag = Bag.create(new THREE.Color(o.bag).convertSRGBToLinear());
                bag.scale.setScalar(0.0125);
                bag.rotation.x = Math.PI / 2;
                bag.position.set(0, 0.04, 0.70);
                g.add(bag);
            }

            g.position.set(o.x, o.y, DECK_Z);
            g.rotation.z = o.phi || 0;
            g.scale.setScalar(1 / K);          // people are modelled at world size
            this.group.add(g);
            this.collider(0.5 / K, 0.5 / K, 1.1 / K, new THREE.Vector3(o.x, o.y, DECK_Z + 0.55 / K));
            this.npcs.push({ group : g, head : head, home : o.phi || 0, name : o.name, lines : o.lines || [], line : 0, turn : o.turn !== false });
            return g;
        },

        // ====================================================================
        //  Art, rugs and trophies: original pieces that give the store some life
        // ====================================================================

        // every painting is drawn here; `kind` picks one
        artTexture : function(kind, w, h)
        {
            var R = (seed) => { var x = Math.sin(seed * 127.1 + 11.7) * 43758.5453; return x - Math.floor(x); };
            return this.drawnTexture(w, h, (ctx, W, H, img) =>
            {
                var sky = (stops) =>
                {
                    var g = ctx.createLinearGradient(0, 0, 0, H);
                    stops.forEach((s) => g.addColorStop(s[0], s[1]));
                    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
                };
                var ridge = (base, amp, color, seed, snow) =>
                {
                    ctx.fillStyle = color;
                    ctx.beginPath(); ctx.moveTo(0, H);
                    var pts = [];
                    for (var i = 0; i <= 24; i++)
                    {
                        var x = i / 24 * W;
                        var y = H * base - amp * H * (0.5 + 0.5 * Math.sin(i * 0.9 + seed) * Math.cos(i * 0.37 + seed * 2)) - R(i + seed * 9) * amp * H * 0.35;
                        pts.push([x, y]); ctx.lineTo(x, y);
                    }
                    ctx.lineTo(W, H); ctx.fill();
                    if (snow)
                    {
                        ctx.fillStyle = snow;
                        for (var k = 1; k < pts.length - 1; k++)
                        {
                            if (pts[k][1] < pts[k - 1][1] && pts[k][1] < pts[k + 1][1])
                            {
                                ctx.beginPath(); ctx.moveTo(pts[k][0], pts[k][1]);
                                ctx.lineTo(pts[k][0] - W * 0.035, pts[k][1] + H * 0.07); ctx.lineTo(pts[k][0] - W * 0.008, pts[k][1] + H * 0.05);
                                ctx.lineTo(pts[k][0] + W * 0.012, pts[k][1] + H * 0.085); ctx.lineTo(pts[k][0] + W * 0.04, pts[k][1] + H * 0.06);
                                ctx.fill();
                            }
                        }
                    }
                };
                var clouds = (n, y0, y1, color) =>
                {
                    ctx.fillStyle = color;
                    for (var c = 0; c < n; c++)
                    {
                        var cx = R(c + 3) * W, cy = H * (y0 + R(c + 40) * (y1 - y0));
                        for (var b = 0; b < 6; b++)
                        {
                            ctx.beginPath(); ctx.ellipse(cx + (b - 3) * W * 0.035, cy + R(c * 7 + b) * H * 0.02, W * 0.06, H * 0.028, 0, 0, Math.PI * 2); ctx.fill();
                        }
                    }
                };

                if (kind == "meadow")
                {
                    sky([[0, "#2f6fd0"], [0.6, "#8fc1f0"]]);
                    clouds(5, 0.05, 0.3, "rgba(255,255,255,0.9)");
                    ridge(0.56, 0.2, "#dfe9f5", 1.3, "#ffffff");
                    ridge(0.62, 0.1, "#7f93ad", 4.1);
                    // sloping meadow with flowers
                    ctx.fillStyle = "#4f8a2f";
                    ctx.beginPath(); ctx.moveTo(0, H * 0.78); ctx.lineTo(W, H * 0.5); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
                    for (var f = 0; f < 900; f++)
                    {
                        var fx = R(f) * W, fy = H * (0.5 + R(f + 500) * 0.5);
                        if (fy < H * 0.78 - fx / W * H * 0.28) continue;
                        ctx.fillStyle = f % 5 == 0 ? "#2f6b22" : "#f4d63a";
                        ctx.fillRect(fx, fy, 3 + (fy / H) * 3, 3 + (fy / H) * 3);
                    }
                    // someone lying in the grass, arms out
                    ctx.save(); ctx.translate(W * 0.52, H * 0.78); ctx.rotate(-0.28);
                    ctx.fillStyle = "#3b4350"; ctx.fillRect(-W * 0.035, -H * 0.01, W * 0.03, H * 0.12); ctx.fillRect(W * 0.005, -H * 0.01, W * 0.03, H * 0.12);
                    ctx.fillStyle = "#e9edf0"; ctx.fillRect(-W * 0.045, -H * 0.1, W * 0.09, H * 0.1); ctx.fillRect(-W * 0.14, -H * 0.085, W * 0.28, H * 0.028);
                    ctx.fillStyle = "#c79a78"; ctx.beginPath(); ctx.arc(0, -H * 0.125, W * 0.028, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                }
                else if (kind == "road")
                {
                    sky([[0, "#1f66c9"], [0.5, "#6fa6e6"], [0.62, "#f0b27a"]]);
                    ridge(0.64, 0.07, "#8a4a52", 2.2);
                    ctx.fillStyle = "#c98f63"; ctx.fillRect(0, H * 0.64, W, H);
                    // road to the horizon
                    ctx.fillStyle = "#6b5a55";
                    ctx.beginPath(); ctx.moveTo(W * 0.49, H * 0.64); ctx.lineTo(W * 0.51, H * 0.64); ctx.lineTo(W * 0.8, H); ctx.lineTo(W * 0.2, H); ctx.fill();
                    ctx.fillStyle = "#f2e3b0";
                    for (var d = 0; d < 7; d++) { var t = d / 7, yy = H * (0.66 + t * t * 0.34); ctx.fillRect(W * 0.5 - 2 - t * 5, yy, 4 + t * 10, H * 0.012 + t * H * 0.03); }
                    // rear-view mirror holding a wildfire sunset
                    ctx.fillStyle = "#0e0c0a"; ctx.fillRect(W * 0.47, 0, W * 0.06, H * 0.1);
                    var mx = W * 0.12, my = H * 0.09, mw = W * 0.76, mh = H * 0.2;
                    ctx.beginPath(); ctx.ellipse(mx + mw / 2, my + mh / 2, mw / 2, mh / 2, 0, 0, Math.PI * 2); ctx.fill();
                    var g2 = ctx.createLinearGradient(0, my, 0, my + mh);
                    g2.addColorStop(0, "#3a1c12"); g2.addColorStop(0.45, "#f0892a"); g2.addColorStop(0.7, "#ffcf5a"); g2.addColorStop(1, "#2a1410");
                    ctx.fillStyle = g2;
                    ctx.beginPath(); ctx.ellipse(mx + mw / 2, my + mh / 2, mw / 2 - W * 0.02, mh / 2 - H * 0.018, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = "#17335e"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                    ctx.font = Math.round(H * 0.05) + "px " + FONT_MONO;
                    ["loud", "is a", "bluff"].forEach((word, i) => ctx.fillText(word, W * (0.2 + i * 0.3), H * 0.42));
                }
                else if (kind == "arches")
                {
                    sky([[0, "#1b1740"], [0.55, "#4a3f8f"], [0.8, "#c9963f"]]);
                    // city lights across the water
                    for (var l = 0; l < 160; l++) { ctx.fillStyle = "rgba(255,210,120," + (0.4 + R(l) * 0.6) + ")"; ctx.fillRect(R(l + 9) * W, H * (0.62 + R(l + 77) * 0.12), 3, 3); }
                    ctx.fillStyle = "#e9c36a"; ctx.fillRect(W * 0.43, H * 0.52, W * 0.14, H * 0.12);
                    ctx.beginPath(); ctx.moveTo(W * 0.5, H * 0.4); ctx.lineTo(W * 0.56, H * 0.52); ctx.lineTo(W * 0.44, H * 0.52); ctx.fill();
                    // stone arcade in front
                    ctx.fillStyle = "#6f6248";
                    ctx.fillRect(0, 0, W, H * 0.16); ctx.fillRect(0, H * 0.82, W, H * 0.18);
                    [0, 0.31, 0.62, 0.93].forEach((px) => ctx.fillRect(W * px, 0, W * 0.075, H));
                    ctx.fillStyle = "#6f6248";
                    [[0.075, 0.31], [0.385, 0.62], [0.695, 0.93]].forEach((a) =>
                    {
                        var x0 = W * a[0], x1 = W * a[1], r = (x1 - x0) / 2;
                        ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, H * 0.16 + r);
                        ctx.arc(x0 + r, H * 0.16 + r, r, Math.PI, 0, false);
                        ctx.fill("evenodd");
                    });
                    ctx.fillStyle = "#57492f";
                    [0, 0.31, 0.62, 0.93].forEach((px) => { ctx.fillRect(W * px - 4, H * 0.3, W * 0.075 + 8, H * 0.03); ctx.fillRect(W * px - 4, H * 0.8, W * 0.075 + 8, H * 0.03); });
                    // a figure watching, bag across the back
                    ctx.fillStyle = "#15131c";
                    ctx.beginPath(); ctx.arc(W * 0.8, H * 0.6, W * 0.035, 0, Math.PI * 2); ctx.fill();
                    ctx.fillRect(W * 0.755, H * 0.64, W * 0.09, H * 0.2);
                    ctx.fillStyle = C.beige; ctx.beginPath(); ctx.ellipse(W * 0.79, H * 0.74, W * 0.03, H * 0.06, 0.4, 0, Math.PI * 2); ctx.fill();
                }
                else if (kind == "volcano")
                {
                    sky([[0, "#2b3a5a"], [0.45, "#b9826a"], [0.7, "#e8c08a"]]);
                    ridge(0.6, 0.3, "#5a4a52", 0.2, "#f3e9dc");
                    clouds(4, 0.4, 0.55, "rgba(240,205,170,0.75)");
                    ctx.fillStyle = "#3a2a1c"; ctx.fillRect(0, H * 0.68, W, H);
                    ctx.fillStyle = "#b5651f"; ctx.fillRect(0, H * 0.68, W, H * 0.03);
                    // herd on the plain, two herders
                    for (var s = 0; s < 46; s++) { ctx.fillStyle = s % 3 ? "#d9843a" : "#8a4a22"; ctx.beginPath(); ctx.ellipse(R(s) * W, H * (0.8 + R(s + 30) * 0.14), W * 0.03, H * 0.016, 0, 0, Math.PI * 2); ctx.fill(); }
                    [[0.56, "#1f6f5a"], [0.63, "#a12d26"]].forEach((p) =>
                    {
                        ctx.fillStyle = p[1]; ctx.fillRect(W * p[0], H * 0.7, W * 0.035, H * 0.09);
                        ctx.fillStyle = "#2a1c12"; ctx.beginPath(); ctx.arc(W * (p[0] + 0.0175), H * 0.69, W * 0.016, 0, Math.PI * 2); ctx.fill();
                    });
                }
                else if (kind == "glyphs")
                {
                    ctx.fillStyle = "#0e0d0b"; ctx.fillRect(0, 0, W, H);
                    for (var n = 0; n < 2500; n++) { ctx.fillStyle = "rgba(255,255,255," + R(n) * 0.12 + ")"; ctx.fillRect(R(n + 1) * W, R(n + 2) * H, 2, 2); }
                    // hand-cut blob marks on a grid, the Bluff mark among them
                    ctx.fillStyle = C.cream; ctx.strokeStyle = C.cream; ctx.lineCap = "round"; ctx.lineJoin = "round";
                    for (var gy = 0; gy < 3; gy++) for (var gx = 0; gx < 2; gx++)
                    {
                        var cx0 = W * (0.27 + gx * 0.46), cy0 = H * (0.2 + gy * 0.3), id = gy * 2 + gx, rr = W * 0.13;
                        if (id == 3 && img) { this.drawLogo(ctx, img, cx0 - rr * 1.25, cy0 - rr * 1.25, rr * 2.5, C.orange); continue; }
                        ctx.lineWidth = rr * 0.42;
                        ctx.beginPath();
                        for (var a = 0; a <= 5; a++)
                        {
                            var ang = a / 5 * Math.PI * 2 + id, r2 = rr * (0.35 + R(id * 13 + a) * 0.75);
                            var bx = cx0 + Math.cos(ang * (1 + id % 2)) * r2, by2 = cy0 + Math.sin(ang) * r2;
                            if (a == 0) ctx.moveTo(bx, by2); else ctx.lineTo(bx, by2);
                        }
                        ctx.stroke();
                        ctx.beginPath(); ctx.arc(cx0 + rr * 0.2 * Math.cos(id), cy0 - rr * 0.9, rr * 0.2, 0, Math.PI * 2); ctx.fill();
                    }
                    ctx.strokeStyle = "rgba(232,227,216,0.35)"; ctx.lineWidth = 2;
                    ctx.strokeRect(W * 0.04, H * 0.035, W * 0.92, H * 0.93);
                    ctx.beginPath(); ctx.moveTo(W * 0.5, H * 0.035); ctx.lineTo(W * 0.5, H * 0.965);
                    ctx.moveTo(W * 0.04, H * 0.35); ctx.lineTo(W * 0.96, H * 0.35); ctx.moveTo(W * 0.04, H * 0.65); ctx.lineTo(W * 0.96, H * 0.65); ctx.stroke();
                }
                else if (kind == "mark")
                {
                    // the Bluff mark, loud for once
                    ctx.fillStyle = "#f1ece0"; ctx.fillRect(0, 0, W, H);
                    if (img)
                    {
                        this.drawLogo(ctx, img, W * 0.1 + 10, H * 0.5 - W * 0.4 + 10, W * 0.8, "#0e0d0b");
                        this.drawLogo(ctx, img, W * 0.1, H * 0.5 - W * 0.4, W * 0.8, C.orange);
                    }
                    ctx.fillStyle = "#0e0d0b"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
                    ctx.font = "600 " + Math.round(H * 0.035) + "px " + FONT_MONO;
                    ctx.fillText("On mute.", W * 0.08, H * 0.93);
                }
                else
                {
                    // portraits: flat, quiet, each wearing the bag
                    var P = { p1 : ["#a12d26", "#8d5b3e", "#15110e", "#e8e3d8", C.washed], p2 : ["#3e6fa3", "#c79a78", "#5a3a22", "#6E6B4E", C.clay],
                              p3 : ["#e8a03a", "#5c3a28", "#0e0c0a", "#12110F", C.beige], p4 : ["#56467f", "#d9b08c", "#b9b3a6", "#9A968B", C.orange] }[kind] || ["#6f9a3b", "#a8734f", "#1a1512", "#e8e3d8", C.washed];
                    ctx.fillStyle = P[0]; ctx.fillRect(0, 0, W, H);
                    for (var q = 0; q < 1800; q++) { ctx.fillStyle = "rgba(0,0,0," + R(q) * 0.08 + ")"; ctx.fillRect(R(q + 5) * W, R(q + 6) * H, 3, 3); }
                    // shoulders
                    ctx.fillStyle = P[3];
                    ctx.beginPath(); ctx.moveTo(W * 0.08, H); ctx.quadraticCurveTo(W * 0.1, H * 0.66, W * 0.38, H * 0.62); ctx.lineTo(W * 0.62, H * 0.62);
                    ctx.quadraticCurveTo(W * 0.9, H * 0.66, W * 0.92, H); ctx.fill();
                    // strap across the chest
                    ctx.strokeStyle = P[4]; ctx.lineWidth = W * 0.075; ctx.beginPath(); ctx.moveTo(W * 0.3, H * 0.63); ctx.lineTo(W * 0.78, H); ctx.stroke();
                    // neck, head, hair
                    ctx.fillStyle = P[1]; ctx.fillRect(W * 0.43, H * 0.5, W * 0.14, H * 0.14);
                    ctx.beginPath(); ctx.ellipse(W * 0.5, H * 0.36, W * 0.17, H * 0.19, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = P[2];
                    ctx.beginPath(); ctx.ellipse(W * 0.5, H * 0.25, W * 0.19, H * 0.11, 0, Math.PI, Math.PI * 2); ctx.fill();
                    ctx.fillRect(W * 0.31, H * 0.24, W * 0.05, H * 0.1); ctx.fillRect(W * 0.64, H * 0.24, W * 0.05, H * 0.1);
                    // sunglasses and a flat mouth: nothing to prove
                    ctx.fillStyle = "#0e0c0a";
                    ctx.fillRect(W * 0.36, H * 0.33, W * 0.12, H * 0.045); ctx.fillRect(W * 0.52, H * 0.33, W * 0.12, H * 0.045); ctx.fillRect(W * 0.47, H * 0.345, W * 0.06, H * 0.012);
                    ctx.fillRect(W * 0.45, H * 0.455, W * 0.1, H * 0.01);
                }
                // light canvas grain over everything
                for (var z = 0; z < 1200; z++) { ctx.fillStyle = "rgba(255,255,255," + R(z + 900) * 0.05 + ")"; ctx.fillRect(R(z + 901) * W, R(z + 902) * H, 2, 2); }
            });
        },

        // a painting in a frame on a wall. (x, y, z) is its centre, phi the way it faces.
        framed : function(kind, w, h, x, y, z, phi, frame)
        {
            var nx = Math.sin(phi), ny = -Math.cos(phi), b = 0.14;
            var fm = frame == "black" ? this.brand("#0e0d0b", { roughness : 0.5 }) : this.gold();
            var back = this.box(w + 2 * b, 0.1, h + 2 * b, x + nx * 0.05, y + ny * 0.05, z - h / 2 - b, fm, false, phi);
            this.wallPlane(w, h, new THREE.MeshBasicMaterial({ map : this.artTexture(kind, 384, Math.round(384 * h / w)) }), x + nx * 0.11, y + ny * 0.11, z, phi);
            return back;
        },

        gold : function()
        {
            if (!this.gold_material)
            {
                this.gold_material = new THREE.MeshStandardMaterial(
                {
                    color : new THREE.Color("#d9a92e").convertSRGBToLinear(), metalness : 0.55, roughness : 0.3,
                    emissive : new THREE.Color("#5a3d08").convertSRGBToLinear(),
                });
            }
            return this.gold_material;
        },

        // a cup on a dark base, `size` plan units tall, standing at (x, y, z)
        trophy : function(x, y, z, size, style)
        {
            var g = new THREE.Group();
            var pts;
            if (style == 1) pts = [[0.0, 0.0], [0.2, 0.0], [0.2, 0.04], [0.06, 0.1], [0.05, 0.36], [0.12, 0.42], [0.3, 0.6], [0.34, 0.9], [0.3, 0.92], [0.0, 0.62]];
            else if (style == 2) pts = [[0.0, 0.0], [0.24, 0.0], [0.22, 0.06], [0.08, 0.12], [0.07, 0.3], [0.26, 0.4], [0.3, 0.75], [0.2, 0.95], [0.0, 0.96]];
            else pts = [[0.0, 0.0], [0.22, 0.0], [0.22, 0.05], [0.07, 0.1], [0.05, 0.4], [0.16, 0.46], [0.36, 0.72], [0.4, 0.98], [0.36, 1.0], [0.0, 0.7]];
            var cup = new THREE.Mesh(new THREE.LatheBufferGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), 24), this.gold());
            cup.rotation.x = Math.PI / 2;                 // lathe axis is Y: stand it on Z
            cup.material.side = THREE.DoubleSide;
            cup.position.z = 0.22;
            g.add(cup);
            // handles
            [-1, 1].forEach((s) =>
            {
                var handle = new THREE.Mesh(new THREE.TorusBufferGeometry(0.16, 0.035, 8, 16, Math.PI), this.gold());
                handle.rotation.set(Math.PI / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2);
                handle.position.set(s * 0.33, 0, 0.22 + 0.78);
                if (style != 2) g.add(handle);
            });
            var base = new THREE.Mesh(new THREE.BoxBufferGeometry(0.5, 0.5, 0.22), this.brand("#0e0d0b", { roughness : 0.4 }));
            base.position.z = 0.11;
            g.add(base);
            var plate = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.36, 0.1), this.glow(C.orange));
            plate.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
            plate.position.set(0, -0.255, 0.11);
            g.add(plate);
            g.position.set(x, y, z);
            g.scale.setScalar(size / 1.22);
            this.group.add(g);
            return g;
        },

        // woven rug, drawn as one quarter and mirrored
        rugTexture : function(palette)
        {
            return this.drawnTexture(384, 576, (ctx, W, H) =>
            {
                var R = (seed) => { var x = Math.sin(seed * 91.3 + 3.1) * 43758.5453; return x - Math.floor(x); };
                var q = this.canvas(W / 2, H / 2), c = q.getContext("2d"), w = W / 2, h = H / 2;
                c.fillStyle = palette[0]; c.fillRect(0, 0, w, h);
                // borders
                [[0, palette[1]], [10, palette[2]], [16, palette[0]], [30, palette[3]], [34, palette[1]]].forEach((b) => { c.fillStyle = b[1]; c.fillRect(b[0], b[0], w, h); });
                c.fillStyle = palette[0]; c.fillRect(40, 40, w, h);
                // border flowers
                for (var i = 0; i < 16; i++) { c.fillStyle = i % 2 ? palette[3] : palette[2]; c.fillRect(20 + i * 12, 20, 6, 6); c.fillRect(20, 20 + i * 18, 6, 6); }
                // field of small motifs
                for (var n = 0; n < 240; n++)
                {
                    var x = 44 + R(n) * (w - 44), y = 44 + R(n + 400) * (h - 44), s = 3 + R(n + 800) * 6;
                    c.fillStyle = [palette[1], palette[2], palette[3]][n % 3];
                    c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillRect(-s / 2, -s / 2, s, s); c.restore();
                }
                // medallion at the centre of the rug (bottom-right of the quarter)
                [[0.62, palette[1]], [0.5, palette[2]], [0.36, palette[0]], [0.22, palette[3]], [0.1, palette[1]]].forEach((m) =>
                {
                    c.fillStyle = m[1];
                    c.beginPath(); c.moveTo(w, h - h * m[0]); c.lineTo(w - w * m[0] * 0.9, h); c.lineTo(w, h); c.fill();
                });
                // mirror into all four quarters
                ctx.drawImage(q, 0, 0);
                ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(q, 0, 0); ctx.restore();
                ctx.save(); ctx.translate(0, H); ctx.scale(1, -1); ctx.drawImage(q, 0, 0); ctx.restore();
                ctx.save(); ctx.translate(W, H); ctx.scale(-1, -1); ctx.drawImage(q, 0, 0); ctx.restore();
                // worn, hand-knotted look
                for (var k = 0; k < 5000; k++) { ctx.fillStyle = "rgba(240,230,210," + R(k + 77) * 0.16 + ")"; ctx.fillRect(R(k + 78) * W, R(k + 79) * H, 2, 2); }
            });
        },

        rug : function(x, y, w, d, palette, z)
        {
            var mesh = this.floorPlane(w, d, new THREE.MeshStandardMaterial({ map : this.rugTexture(palette), roughness : 1.0 }), x, y, z);
            return mesh;
        },

        plant : function(x, y, size)
        {
            this.box(0.7 * size, 0.7 * size, 0.7 * size, x, y, DECK_Z, this.brand(C.clay, { roughness : 0.8 }), true);
            for (var i = 0; i < 7; i++)
            {
                var leaf = new THREE.Mesh(new THREE.ConeBufferGeometry(0.16 * size, 1.5 * size, 6), this.brand(i % 2 ? "#2f6b3a" : "#3f8a45"));
                leaf.rotation.set(Math.PI / 2 + Math.sin(i * 2.1) * 0.45, 0, i * 0.9);
                leaf.position.set(x + Math.cos(i * 0.9) * 0.18 * size, y + Math.sin(i * 0.9) * 0.18 * size, DECK_Z + (0.7 + 0.7) * size);
                this.group.add(leaf);
            }
        },

        // paintings, portraits, trophies, rugs and plants inside the store
        buildStoreLife : function(cx, cy, x0, x1, fy, by, z0, t)
        {
            var S = 0, E = -Math.PI / 2, W = Math.PI / 2;      // facing of things on the back / east / west walls
            var back = by - t - 0.03, east = x1 - t - 0.03, west = x0 + t + 0.03;

            // rugs: a red one under the centrepiece, a blue one in the lounge
            this.rug(cx, cy - 1, 7.5, 10.5, ["#a12d26", "#efe3cc", "#1f3a5f", "#d9a92e"], z0 + 0.06);
            this.rug(cx - 9, by - 5.4, 6.5, 4.4, ["#1f3a5f", "#efe3cc", "#a12d26", "#d9a92e"], z0 + 0.06);

            // back wall, left of the logo: a salon hang of portraits and landscapes
            this.framed("meadow", 3.6, 2.6, cx - 12.4, back, z0 + 7.2, S);
            this.framed("p1", 1.7, 2.2, cx - 14.2, back, z0 + 4.1, S);
            this.framed("p2", 1.7, 2.2, cx - 11.9, back, z0 + 4.1, S, "black");
            this.framed("glyphs", 2.0, 3.0, cx - 8.2, back, z0 + 6.6, S, "black");
            this.framed("p3", 1.7, 2.2, cx - 9.4, back, z0 + 3.4, S);
            this.framed("arches", 2.6, 2.0, cx - 6.9, back, z0 + 3.5, S);
            // back wall, right of the logo
            this.framed("road", 2.6, 3.4, cx + 8.3, back, z0 + 6.8, S, "black");
            this.framed("volcano", 3.8, 2.6, cx + 12.6, back, z0 + 7.4, S);
            this.framed("p4", 1.7, 2.2, cx + 11.3, back, z0 + 4.4, S);
            this.framed("mark", 1.9, 2.4, cx + 14.0, back, z0 + 4.3, S, "black");

            // trophy cabinet under them
            var tx = cx + 12.2, ty = by - t - 0.75;
            this.box(6.2, 1.1, 1.0, tx, ty, z0, this.brand("#0e0d0b", { roughness : 0.4 }), true);
            this.box(6.4, 1.3, 0.07, tx, ty, z0 + 1.0, this.gold(), false);
            [[-2.3, 1.25, 0], [-1.15, 0.95, 1], [0, 1.6, 0], [1.15, 0.95, 2], [2.3, 1.25, 1]].forEach((p) => this.trophy(tx + p[0], ty, z0 + 1.07, p[1], p[2]));
            this.wallPlane(6.0, 0.34, this.textMaterial("MONDAY SURVIVOR  /  QUIETEST IN THE ROOM  /  BLUFF RUN", { fg : C.orange, mono : true, w : 1024, h : 64, size : 0.6 }), tx, ty - 0.56, z0 + 0.5, 0);

            // east wall, either side of the campaign poster
            this.framed("arches", 3.2, 2.4, east, fy + 3.6, z0 + 6.6, E);
            this.framed("p2", 1.8, 2.3, east, fy + 3.6, z0 + 9.6, E, "black");
            this.framed("meadow", 3.4, 2.5, east, by - 5.2, z0 + 6.4, E, "black");
            this.framed("p1", 1.8, 2.3, east, by - 5.2, z0 + 9.5, E);
            // west wall, above the bags
            this.framed("volcano", 4.2, 2.8, west, fy + 4.6, z0 + 8.6, W);
            this.framed("road", 2.4, 3.1, west, fy + 19.6, z0 + 8.4, W, "black");
            this.framed("p3", 1.8, 2.3, west, fy + 16.6, z0 + 8.2, W);
            this.framed("p4", 1.8, 2.3, west, fy + 7.9, z0 + 11.4, W, "black");

            // plants
            this.plant(x0 + 2.0, fy + 1.7, 1.0);
            this.plant(x1 - 2.0, fy + 1.7, 1.0);
            this.plant(cx - 13.2, by - 2.0, 1.2);
            this.plant(cx + 5.6, by - 1.9, 0.9);
        },

        // ====================================================================
        //  Bluff store: the flagship at the top of the main street. You can walk in.
        // ====================================================================

        buildBluffStore : function()
        {
            var w = 36, d = 24, h = 15, cx = 0, cy = 55, z0 = DECK_Z, t = 0.6;
            var fy = cy - d / 2, by = cy + d / 2, x0 = cx - w / 2, x1 = cx + w / 2;
            var black = this.brand(C.washed, { roughness : 0.5 });
            var beige = this.brand("#b3a68f", { roughness : 0.75 });
            var neon = this.glow(C.orange);
            var warm = this.glow("#fff0d2");
            var brass = this.brand("#b08d57", { roughness : 0.3, metalness : 0.8 });
            var door = 5, pylon = 5, glass_h = 9;

            // ---- shell -------------------------------------------------------
            this.box(w, t, h, cx, by - t / 2, z0, black, true);                        // back
            this.box(t, d, h, x0 + t / 2, cy, z0, black, true);                        // west
            this.box(t, d, h, x1 - t / 2, cy, z0, black, true);                        // east
            this.box(pylon, t, h, x0 + pylon / 2, fy + t / 2, z0, black, true);        // front pylons
            this.box(pylon, t, h, x1 - pylon / 2, fy + t / 2, z0, black, true);
            this.box(w - 2 * pylon, t, h - glass_h, cx, fy + t / 2, z0 + glass_h, black, false);   // header over the glass
            this.box(w + 1, d + 1, 0.6, cx, cy, z0 + h, this.brand("#070605"), false);             // roof slab

            // ---- glass front, two storeys tall, with an open doorway ----------
            var pane = (w - 2 * pylon - door) / 2;
            [-1, 1].forEach((s) =>
            {
                var px = cx + s * (door / 2 + pane / 2);
                var g = this.box(pane, 0.12, glass_h, px, fy + 0.3, z0, this.glass(0.2), false);
                g.renderOrder = 2;
                this.collider(pane, 0.4, glass_h, new THREE.Vector3(px, fy + 0.3, z0 + glass_h / 2));
                // slim black mullions
                for (var m = 0; m <= 3; m++)
                {
                    this.box(0.12, 0.2, glass_h, px - pane / 2 + m * pane / 3, fy + 0.3, z0, black, false);
                }
                this.box(pane, 0.2, 0.12, px, fy + 0.3, z0 + 4.4, black, false);
            });
            var over = this.box(door, 0.12, glass_h - 4.4, cx, fy + 0.3, z0 + 4.4, this.glass(0.2), false);
            over.renderOrder = 2;
            // glowing door frame
            this.box(0.14, 0.3, 4.4, cx - door / 2, fy + 0.3, z0, neon, false);
            this.box(0.14, 0.3, 4.4, cx + door / 2, fy + 0.3, z0, neon, false);
            this.box(door + 0.14, 0.3, 0.14, cx, fy + 0.3, z0 + 4.4, neon, false);

            // ---- facade dressing ----------------------------------------------
            // wordmark and tagline on the header
            this.wallPlane(19, 4.6, this.textMaterial("BLUFF", { fg : C.cream, size : 0.86 }), cx, fy - 0.04, z0 + 12.3, 0);
            this.wallPlane(9, 0.6, this.textMaterial("NOTHING TO PROVE.", { fg : C.orange, mono : true, w : 1024, h : 72, size : 0.7 }),
                cx, fy - 0.04, z0 + 9.75, 0);
            // logos and neon fins on the pylons
            [-1, 1].forEach((s) =>
            {
                var px = cx + s * (w / 2 - pylon / 2);
                this.wallPlane(3.8, 3.8, this.logoMaterial(C.cream), px, fy - 0.04, z0 + 10.6, 0);
                this.wallPlane(3.6, 0.42, this.textMaterial("EST. 2026", { fg : C.stone, mono : true, w : 512, h : 64, size : 0.7 }), px, fy - 0.04, z0 + 7.9, 0);
                this.box(0.14, 0.14, h, cx + s * (w / 2 - pylon), fy - 0.08, z0, neon, false);
                this.box(0.14, 0.14, h, cx + s * (w / 2 - 0.07), fy - 0.08, z0, neon, false);
                // stone base
                this.box(pylon + 0.1, 0.2, 1.1, px, fy - 0.08, z0, beige, false);
            });
            this.box(w, 0.14, 0.14, cx, fy - 0.08, z0 + h - 0.2, neon, false);
            this.box(w - 2 * pylon, 0.14, 0.14, cx, fy - 0.08, z0 + glass_h, neon, false);
            // canopy over the door
            this.box(9, 3.4, 0.3, cx, fy - 1.7, z0 + 4.6, black, false);
            this.box(9, 0.1, 0.1, cx, fy - 3.4, z0 + 4.6, neon, false);
            [-1, 1].forEach((s) => this.box(0.12, 0.12, 4.6, cx + s * 4.3, fy - 3.2, z0, brass, true));
            // planters
            [-1, 1].forEach((s) =>
            {
                this.box(1.3, 1.3, 1.1, cx + s * 5.6, fy - 1.2, z0, beige, true);
                var bush = new THREE.Mesh(new THREE.IcosahedronBufferGeometry(0.85, 1), this.brand("#24402c"));
                bush.position.set(cx + s * 5.6, fy - 1.2, z0 + 1.8);
                this.group.add(bush);
            });

            // ---- roof: a giant bag turning inside the logo's ring -------------
            this.box(0.6, 0.6, 1.2, cx, fy + 6, z0 + h + 0.6, black, false);
            this.displayBag(C.clay, cx, fy + 6, z0 + h + 14.2, 0.3, 0, true);
            var ring = new THREE.Mesh(new THREE.TorusBufferGeometry(8.5, 0.22, 10, 72), neon);
            ring.position.set(cx, fy + 6, z0 + h + 2.2);
            this.group.add(ring);
            var ring2 = new THREE.Mesh(new THREE.TorusBufferGeometry(9.3, 0.08, 8, 72), this.glow(C.cream));
            ring2.position.copy(ring.position);
            this.group.add(ring2);

            // ---- interior -----------------------------------------------------
            var iw = w - 2 * t, id = d - 2 * t;
            this.floorPlane(iw, id, this.brand("#0b0a08", { roughness : 0.12, metalness : 0.35 }), cx, cy, z0 + 0.03);
            // raw concrete walls, warmed towards dust beige
            this.wallPlane(iw, h, this.concrete(2, 1.5, "#e2d8c6"), cx, by - t - 0.02, z0 + h / 2, 0);
            this.wallPlane(id, h, this.concrete(1.4, 1.5, "#e2d8c6"), x0 + t + 0.02, cy, z0 + h / 2, Math.PI / 2);
            this.wallPlane(id, h, this.concrete(1.4, 1.5, "#e2d8c6"), x1 - t - 0.02, cy, z0 + h / 2, -Math.PI / 2);
            // dark skirting and a brass line round the room
            this.box(iw, 0.1, 0.5, cx, by - t - 0.05, z0, black, false);
            this.box(0.1, id, 0.5, x0 + t + 0.05, cy, z0, black, false);
            this.box(0.1, id, 0.5, x1 - t - 0.05, cy, z0, black, false);
            this.box(iw, 0.06, 0.06, cx, by - t - 0.05, z0 + 8.2, brass, false);
            // ceiling with light slots
            var ceiling = this.floorPlane(iw, id, this.brand("#070605"), cx, cy, z0 + h - 0.02);
            ceiling.rotation.x = Math.PI;
            [-12, -4, 4, 12].forEach((lx) => this.box(0.5, id - 3, 0.1, cx + lx, cy, z0 + h - 0.14, warm, false));
            // chandelier: the logo's ring, three times
            [[4.2, 10.4, C.cream], [3.1, 9.5, C.orange], [2.0, 8.6, C.cream]].forEach((r) =>
            {
                var torus = new THREE.Mesh(new THREE.TorusBufferGeometry(r[0], 0.09, 8, 64), this.glow(r[2]));
                torus.position.set(cx, cy - 1, z0 + r[1]);
                this.group.add(torus);
                this.spinners.push(torus);
            });
            this.box(0.04, 0.04, h - 10.4, cx, cy - 1, z0 + 10.4, brass, false);

            var lamp = new THREE.PointLight(0xffe6c0, 0.5, 28, 2);
            lamp.position.set(cx, cy - 1, z0 + 8);
            this.group.add(lamp);

            // orange runner from the plaza to the centrepiece
            this.floorPlane(door - 0.6, 8.5, this.brand(C.orange, { roughness : 0.95 }), cx, fy + 4.4, z0 + 0.05);
this.buildStoreLife(cx, cy, x0, x1, fy, by, z0, t);

            // centrepiece: tall glass case with a turning bag
            this.vitrine(cx, cy - 1, C.olive, { size : 1.9, plinth : 0.85, tall : 2.5, base : C.washed, spin : true });
            // product plaque on the centre plinth
            this.wallPlane(1.86, 0.5, this.textMaterial("THE CRESCENT", { fg : C.cream, w : 768, h : 200, size : 0.78 }), cx, cy - 1 - 0.96, z0 + 0.52, 0);
            this.wallPlane(1.86, 0.2, this.textMaterial("BATCH 01  /  900 EGP  /  FREE DELIVERY", { fg : C.orange, mono : true, w : 1024, h : 110, size : 0.5 }), cx, cy - 1 - 0.96, z0 + 0.2, 0);

            // west wall: bags hanging on brass rails in lit niches, one colourway each
            for (var i = 0; i < 8; i++)
            {
                var bc = BAG_COLOURS[[0, 5, 1, 6, 2, 8, 3, 9][i]];
                var y = fy + 3.2 + i * 2.5, wx = x0 + t;
                this.wallPlane(1.9, 2.5, this.brand("#1a1815"), wx + 0.04, y, z0 + 1.95, Math.PI / 2);
                this.box(0.06, 1.9, 0.06, wx + 0.07, y, z0 + 3.2, warm, false);
                this.box(0.34, 0.05, 0.05, wx + 0.17, y, z0 + 2.7, brass, false);
                this.displayBag(bc.color, wx + 0.36, y, z0 + 2.67, 0.03, 0, false);
                this.wallPlane(1.8, 0.2, this.textMaterial(bc.name + " / 900 EGP", { fg : C.cream, mono : true, w : 512, h : 64, size : 0.62 }),
                    wx + 0.06, y, z0 + 0.98, Math.PI / 2);
            }
            this.wallPlane(13, 1.5, this.textMaterial("THE CRESCENT", { fg : C.washed, size : 0.86 }), x0 + t + 0.06, fy + 12, z0 + 5.6, Math.PI / 2);
            this.wallPlane(9, 0.42, this.textMaterial("BATCH 01  /  THE INSIDE? NOT OUR THING.", { fg : C.clay, mono : true, w : 1024, h : 72, size : 0.62 }), x0 + t + 0.06, fy + 12, z0 + 4.55, Math.PI / 2);
            // a long low shelf under them with folded dust bags
            this.box(0.7, 19.5, 0.5, x0 + t + 0.4, fy + 12, z0, black, true);

            // east side: glass cases on plinths in two rows, campaign wall behind them
            for (var j = 0; j < 6; j++)
            {
                var c = BAG_COLOURS[[7, 4, 9, 5, 6, 8][j]];
                this.vitrine(x1 - 3.2 - (j % 2) * 3.4, fy + 3.5 + Math.floor(j / 2) * 4.2 + (j % 2) * 2.1, c.color, { rotZ : Math.PI });
            }
            var poster = this.drawnTexture(768, 1024, (ctx, W, H, img) =>
            {
                ctx.fillStyle = C.orange; ctx.fillRect(0, 0, W, H);
                if (img) this.drawLogo(ctx, img, W * 0.14, H * 0.08, W * 0.72, C.washed);
                ctx.fillStyle = C.washed; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.font = Math.round(H * 0.12) + "px " + FONT_MARK;
                ctx.fillText("NOTHING", W / 2, H * 0.72, W * 0.9);
                ctx.fillText("TO PROVE.", W / 2, H * 0.84, W * 0.9);
                ctx.font = "600 " + Math.round(H * 0.022) + "px " + FONT_MONO;
                ctx.fillText("BLUFF  •  EST. 2026  •  BLUFF.508.WORLD", W / 2, H * 0.95, W * 0.9);
            });
            this.wallPlane(7.5, 10, new THREE.MeshBasicMaterial({ map : poster }), x1 - t - 0.1, cy - 2, z0 + 8.2, -Math.PI / 2);
            this.box(0.12, 7.9, 10.4, x1 - t, cy - 2, z0 + 3.0, black, false);

            // back wall: glowing logo over the cash desk
            var halo = new THREE.Mesh(new THREE.CircleBufferGeometry(4.3, 64), this.glow(C.orange));
            halo.position.set(cx, by - t - 0.06, z0 + 9.4);
            halo.rotation.x = Math.PI / 2;
            this.group.add(halo);
            this.wallPlane(7.2, 7.2, this.logoMaterial(C.washed), cx, by - t - 0.1, z0 + 9.4, 0);
            this.wallPlane(11, 1.1, this.textMaterial("NOTHING TO PROVE.", { fg : C.washed, size : 0.8 }), cx, by - t - 0.08, z0 + 4.5, 0);

            // cash desk, till and cashier
            var desk_y = by - 4.2;
            var dh = 0.92;
            this.box(9, 1.5, dh, cx, desk_y, z0, black, true);
            this.box(9.3, 1.8, 0.08, cx, desk_y, z0 + dh, this.brand(C.beige, { roughness : 0.35 }), false);
            this.wallPlane(8.6, 0.6, this.textMaterial("CASH DESK", { fg : C.orange, mono : true, w : 512, h : 64, size : 0.66 }), cx, desk_y - 0.78, z0 + 0.5, 0);
            this.box(0.6, 0.45, 0.3, cx + 2.6, desk_y, z0 + dh + 0.08, this.brand("#1c1a17"), false);          // till
            this.box(0.6, 0.04, 0.4, cx + 2.6, desk_y + 0.2, z0 + dh + 0.38, this.glow("#9fd6ff"), false);    // screen
            this.box(0.5, 0.3, 0.55, cx - 2.8, desk_y, z0 + dh + 0.08, this.brand(C.orange), false);          // shopping bag
            this.person({ x : cx + 1.2, y : desk_y + 1.7, phi : 0, name : "Cashier", bag : C.clay,
                shirt : C.washed, pants : C.stone, skin : "#8d5b3e",
                lines : ["Welcome to BLUFF. Lower your voice.", "The Crescent, Batch 01. 900 EGP, delivery is free.", "Please don't call us a brand. We don't have the energy for a PR crisis."] });

            // sales person on the floor
            this.person({ x : cx - 5.5, y : fy + 6.5, phi : 0, name : "Sales", bag : C.olive,
                shirt : C.cream, pants : C.washed, skin : "#c79a78", hair : "#3a2a1c",
                lines : ["Burnt-clay zipper puller, orange lining, NFC chip inside. We'd explain the bag, but we won't.", "Loud is a bluff. Carry it when you're already over it.", "Play BLUFF RUN at the booth outside. Grab every logo to win."] });

            // lounge bench
            this.box(5, 1.5, 0.5, cx - 7.5, by - 5, z0, this.brand(C.stone, { roughness : 0.6 }), true);
            this.box(5, 0.3, 0.6, cx - 7.5, by - 4.3, z0 + 0.5, this.brand(C.stone, { roughness : 0.6 }), false);

            // one bag on a plinth out on the plaza
            this.vitrine(-13, 39, C.washed, { size : 1.6, plinth : 0.95, tall : 2.0, base : C.washed, spin : true });
            this.vitrine(13, 39, C.beige, { size : 1.6, plinth : 0.95, tall : 2.0, base : C.washed, spin : true });

            // graffiti on the store's east side wall, facing the park
            var w2 = 12, h2 = 4;
            this.wallPlane(w2, h2, new THREE.MeshStandardMaterial({ map : this.graffitiTexture(w2, h2), roughness : 0.95 }),
                x1 + 0.05, cy, DECK_Z + 2.4, Math.PI / 2);
        },

        // ====================================================================
        //  Activation booth beside the store: BLUFF RUN
        // ====================================================================

        buildBooth : function()
        {
            var bx = this.booth.x, by = this.booth.y, z0 = DECK_Z;
            var black = this.brand(C.washed), neon = this.glow(C.orange);

            // counter with an orange face
            this.box(6.4, 1.2, 1.1, bx, by, z0, black, true);
            this.box(6.6, 1.4, 0.08, bx, by, z0 + 1.1, this.brand(C.beige, { roughness : 0.4 }), false);
            this.wallPlane(6.4, 1.0, this.textMaterial("PRESS  E  TO  PLAY", { fg : C.washed, bg : C.orange, mono : true, w : 1024, h : 160, size : 0.5 }),
                bx, by - 0.62, z0 + 0.55, 0);

            // frame and striped canopy
            [[-3.3, -0.9], [3.3, -0.9], [-3.3, 2.9], [3.3, 2.9]].forEach((p) => this.box(0.18, 0.18, 4.4, bx + p[0], by + p[1], z0, black, true));
            var stripes = this.drawnTexture(256, 256, (ctx, W, H) =>
            {
                for (var i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? C.washed : C.orange; ctx.fillRect(i * W / 8, 0, W / 8, H); }
            });
            var top = new THREE.MeshStandardMaterial({ map : stripes, roughness : 0.9 });
            this.box(7.4, 4.6, 0.22, bx, by + 1.0, z0 + 4.4, [black, black, black, black, top, top], false);
            this.wallPlane(7.4, 1.3, this.textMaterial("BLUFF RUN", { fg : C.cream, bg : C.washed, w : 1024, h : 180, size : 0.8 }), bx, by - 1.32, z0 + 3.9, 0);
            this.box(7.4, 0.1, 0.1, bx, by - 1.34, z0 + 3.2, neon, false);

            // back board with the rules
            this.box(6.6, 0.2, 3.2, bx, by + 2.9, z0 + 0.9, black, true);
            var rules = this.drawnTexture(1024, 512, (ctx, W, H, img) =>
            {
                ctx.fillStyle = C.washed; ctx.fillRect(0, 0, W, H);
                if (img) this.drawLogo(ctx, img, 30, 96, 320, C.orange);
                ctx.fillStyle = C.cream; ctx.textAlign = "left"; ctx.textBaseline = "middle";
                ctx.font = "92px " + FONT_MARK;
                ctx.fillText("GRAB " + this.game.total + " LOGOS", 380, 130, 610);
                ctx.fillStyle = C.orange;
                ctx.fillText("BEAT THE CLOCK", 380, 250, 610);
                ctx.fillStyle = C.stone;
                ctx.font = "600 34px " + FONT_MONO;
                ctx.fillText(this.game.limit + " SECONDS  /  RUN THE BLOCK", 380, 360, 610);
                ctx.fillText("FASTEST TIME GOES ON THE BOARD", 380, 420, 610);
            });
            this.wallPlane(6.4, 3.2, new THREE.MeshBasicMaterial({ map : rules }), bx, by + 2.78, z0 + 2.5, 0);

            // prize bags hanging from the canopy
            [C.clay, C.olive, C.beige].forEach((c, i) => this.displayBag(c, bx - 2 + i * 2, by + 0.2, z0 + 4.25, 0.03, -Math.PI / 2, false));

            // the prize
            this.trophy(bx + 2.4, by, z0 + 1.18, 1.1, 0);

            // attendant
            this.person({ x : bx, y : by + 1.6, phi : 0, name : "Booth", bag : C.stone, shirt : C.orange, pants : C.washed, skin : "#a8734f",
                lines : ["Step up! Grab every logo before the clock runs out.", "Press E when you're ready to run."] });

            // a big token turning on the roof of the booth
            var coin = this.token(bx, by + 1.0, z0 + 6.2, 1.5);
            coin.visible = true;

            // the logos you collect: placed around the plaza, the park and the graffiti yard
            this.game.spots.forEach((p) => this.game.tokens.push(this.token(p[0], p[1], z0 + 1.25, 0.62)));
        },

        // spinning logo coin
        token : function(x, y, z, r)
        {
            var holder = new THREE.Group();
            holder.position.set(x, y, z);
            var disc = new THREE.Mesh(new THREE.CylinderBufferGeometry(r, r, r * 0.16, 32), this.glow(C.orange));
            holder.add(disc);                                   // cylinder axis is Y: faces look along +-Y
            if (!this.token_face) this.token_face = this.logoMaterial(C.washed);
            [1, -1].forEach((s) =>
            {
                var face = new THREE.Mesh(new THREE.PlaneBufferGeometry(r * 1.7, r * 1.7), this.token_face);
                face.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), s > 0 ? 0 : Math.PI)
                    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
                face.position.y = -(r * 0.08 + 0.01) * s;
                holder.add(face);
            });
            holder.visible = false;
            this.group.add(holder);
            this.spinners.push(holder);
            return holder;
        },

        // ====================================================================
        //  On-screen messages and the BLUFF RUN game
        // ====================================================================

        buildHud : function()
        {
            var make = (css) =>
            {
                var el = document.createElement("div");
                el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);z-index:20;pointer-events:none;display:none;" +
                    "background:rgba(18,17,15,0.88);color:#e8e3d8;border:1px solid #ff4e00;padding:10px 22px;text-align:center;" +
                    "font-family:'IBM Plex Mono',monospace;letter-spacing:0.08em;" + css;
                document.body.appendChild(el);
                return el;
            };
            this.hud_top = make("top:18px;font-size:20px;");
            this.hud_msg = make("bottom:9%;font-size:16px;max-width:80%;");
            document.addEventListener("keydown", (e) =>
            {
                var a = document.activeElement;
                if (a && (a.tagName == "INPUT" || a.tagName == "TEXTAREA")) return;
                if (e.code == "KeyE" && this.near_booth && !this.game.running) this.startGame();
                // R: return to the city from anywhere
                if (e.code == "KeyR" && this.player && this.player.initialized) this.respawn(this.player);
            });
        },

        show : function(el, html)
        {
            if (html === null) { if (el.style.display != "none") el.style.display = "none"; return; }
            if (el.innerHTML != html) el.innerHTML = html;
            if (el.style.display != "block") el.style.display = "block";
        },

        startGame : function()
        {
            var g = this.game;
            g.running = true; g.score = 0; g.time = 0; g.result = null;
            g.tokens.forEach((t) => { t.visible = true; });
        },

        endGame : function(won)
        {
            var g = this.game;
            g.running = false;
            g.tokens.forEach((t) => { t.visible = false; });
            var best = null;
            try { best = parseFloat(localStorage.getItem("bluff_run_best")); } catch (e) {}
            if (won)
            {
                if (!(best > 0) || g.time < best)
                {
                    best = g.time;
                    try { localStorage.setItem("bluff_run_best", String(best)); } catch (e) {}
                }
                g.result = "<span style=\"font-family:'Permanent Marker',cursive;font-size:30px;color:#ff4e00\">NOTHING TO PROVE.</span><br>" +
                    "All " + g.total + " logos in " + g.time.toFixed(1) + "s &nbsp;•&nbsp; best " + best.toFixed(1) + "s";
            } else
            {
                g.result = "<span style=\"font-family:'Permanent Marker',cursive;font-size:30px;color:#ff4e00\">TIME'S UP</span><br>" +
                    g.score + " / " + g.total + " logos &nbsp;•&nbsp; back to the booth to run it again";
            }
            g.result_until = 6;
        },

        updateGame : function(delta, pos)
        {
            var g = this.game;
            if (g.running)
            {
                g.time += delta;
                for (var i = 0; i < g.tokens.length; i++)
                {
                    var t = g.tokens[i];
                    if (t.visible && Math.abs(pos.x - t.position.x) < 1.3 && Math.abs(pos.y - t.position.y) < 1.3 && Math.abs(pos.z - DECK_Z) < 3)
                    {
                        t.visible = false;
                        g.score++;
                    }
                }
                var left = Math.max(0, g.limit - g.time);
                this.show(this.hud_top, "BLUFF RUN &nbsp; <span style=\"color:#ff4e00\">" + g.score + " / " + g.total + "</span> &nbsp; " + left.toFixed(1) + "s");
                if (g.score >= g.total) this.endGame(true);
                else if (left <= 0) this.endGame(false);
            } else if (g.result)
            {
                this.show(this.hud_top, g.result);
                g.result_until -= delta;
                if (g.result_until <= 0) g.result = null;
            } else
            {
                this.show(this.hud_top, null);
            }
        },

        updatePeople : function(delta, pos)
        {
            var nearest = null, nearest_d = 4.2;
            for (var i = 0; i < this.npcs.length; i++)
            {
                var n = this.npcs[i], p = n.group.position;
                var dx = pos.x - p.x, dy = pos.y - p.y, dist = Math.sqrt(dx * dx + dy * dy);
                var near = dist < 9 && Math.abs(pos.z - p.z) < 3;
                // turn to face the player when they are close, otherwise look ahead
                var target = (near && n.turn) ? Math.atan2(dx, -dy) : n.home;
                var diff = Math.atan2(Math.sin(target - n.group.rotation.z), Math.cos(target - n.group.rotation.z));
                diff = Math.max(-1.1, Math.min(1.1, diff + n.group.rotation.z - n.home)) + n.home - n.group.rotation.z;
                n.group.rotation.z += diff * Math.min(1, delta * 4);
                // small idle movement
                n.head.rotation.x = Math.sin(this.clock * 1.3 + i * 2.1) * 0.05;
                n.head.rotation.z = Math.sin(this.clock * 0.5 + i) * 0.12;
                if (near && dist < nearest_d) { nearest = n; nearest_d = dist; }
            }
            if (nearest !== this.talking)
            {
                if (nearest) nearest.line = (nearest.line + 1) % nearest.lines.length;
                this.talking = nearest;
            }
            return nearest;
        },

        // ====================================================================
        //  Parks: graffiti yard (west of the store) and Bluff Park (east)
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
            cloud(W * 0.5, H * 0.5, H * 0.75, "rgba(18,17,15,0.85)");
            cloud(W * 0.2, H * 0.55, H * 0.45, "rgba(255,78,0,0.6)");
            cloud(W * 0.82, H * 0.45, H * 0.5, "rgba(182,82,31,0.55)");

            var tex = this.texture(cv);
            var paint = () =>
            {
                // tags
                ctx.save();
                ctx.font = Math.round(H * 0.3) + "px " + FONT_MARK;
                ctx.textBaseline = "middle"; ctx.textAlign = "center";
                ctx.lineJoin = "round";
                var tag = (text, x, y, rot, fill, stroke) =>
                {
                    ctx.save();
                    ctx.translate(x, y); ctx.rotate(rot);
                    ctx.lineWidth = H * 0.045; ctx.strokeStyle = stroke; ctx.strokeText(text, 0, 0, W * 0.3);
                    ctx.fillStyle = fill; ctx.fillText(text, 0, 0, W * 0.3);
                    ctx.restore();
                };
                tag("BLUFF", W * 0.19, H * 0.52, -0.08, C.cream, C.washed);
                tag("WRLD", W * 0.82, H * 0.5, 0.06, C.orange, C.washed);
                ctx.restore();
                tex.needsUpdate = true;
            };
            this.onFonts(paint);

            this.withLogo((img) =>
            {
                var size = H * 0.92;
                // dark outline, then the logo itself, then drips
                this.drawLogo(ctx, img, W / 2 - size / 2 - 6, H * 0.04 - 6, size + 12, C.washed, 0.9);
                this.drawLogo(ctx, img, W / 2 - size / 2, H * 0.04, size, C.cream, 1);
                ctx.fillStyle = "rgba(232,227,216,0.9)";
                for (var k = 0; k < 9; k++)
                {
                    var dx = W * 0.4 + this.random() * W * 0.2, len = H * (0.08 + this.random() * 0.22);
                    ctx.fillRect(dx, H * 0.78, 4, len);
                    ctx.beginPath(); ctx.arc(dx + 2, H * 0.78 + len, 4, 0, Math.PI * 2); ctx.fill();
                }
                tex.needsUpdate = true;
            });
            return tex;
        },

        tree : function(x, y, scale, leaf)
        {
            var trunk = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.18 * scale, 0.26 * scale, 2.2 * scale, 8), this.matte("#3a2f28"));
            trunk.rotation.x = Math.PI / 2;
            trunk.position.set(x, y, DECK_Z + 1.1 * scale);
            this.group.add(trunk);
            var leaves = this.brand(leaf || "#2f5a36");
            [[1.7, 2.6], [1.3, 3.8], [0.8, 4.8]].forEach((l) =>
            {
                var blob = new THREE.Mesh(new THREE.IcosahedronBufferGeometry(l[0] * scale, 1), leaves);
                blob.position.set(x, y, DECK_Z + l[1] * scale);
                this.group.add(blob);
            });
            this.collider(0.6 * scale, 0.6 * scale, 4, new THREE.Vector3(x, y, DECK_Z + 2));
        },

        bench : function(x, y, phi)
        {
            var wood = this.brand(C.clay, { roughness : 0.7 }), iron = this.brand(C.washed);
            this.box(3.0, 0.8, 0.12, x, y, DECK_Z + 0.42, wood, false, phi);
            this.box(3.0, 0.8, 0.42, x, y, DECK_Z, iron, true, phi);
            var nx = Math.sin(phi), ny = -Math.cos(phi);
            this.box(3.0, 0.12, 0.6, x - nx * 0.38, y - ny * 0.38, DECK_Z + 0.54, wood, false, phi);
        },

        parkLamp : function(x, y)
        {
            this.box(0.14, 0.14, 3.4, x, y, DECK_Z, this.brand(C.washed), false);
            var b = new THREE.Mesh(new THREE.SphereBufferGeometry(0.3, 12, 8), this.glow("#fff0d2"));
            b.position.set(x, y, DECK_Z + 3.6);
            this.group.add(b);
        },

        flowerBed : function(x, y, w, d)
        {
            this.box(w, d, 0.35, x, y, DECK_Z, this.brand(C.stone, { roughness : 0.8 }), true);
            var colours = [C.orange, C.clay, C.cream, "#e9b949"];
            for (var i = 0; i < w * d * 2.2; i++)
            {
                var f = new THREE.Mesh(new THREE.IcosahedronBufferGeometry(0.16 + this.random() * 0.1, 0),
                    this.brand(colours[Math.floor(this.random() * colours.length)]));
                f.position.set(x + (this.random() - 0.5) * (w - 0.4), y + (this.random() - 0.5) * (d - 0.4), DECK_Z + 0.5 + this.random() * 0.15);
                this.group.add(f);
            }
        },

        buildParks : function()
        {
            // ---- graffiti yard, west of the store ------------------------------
            var w = 26, h = 6.5;
            this.box(w, 0.8, h, -43, 64, DECK_Z, this.concrete(2, 1), true);
            this.wallPlane(w, h, new THREE.MeshStandardMaterial({ map : this.graffitiTexture(w, h), roughness : 0.95 }),
                -43, 64 - 0.42, DECK_Z + h / 2, 0);
            this.tree(-63, 40, 1.2);
            this.tree(-62, 60, 1.0);
            this.bench(-43, 52, Math.PI);

            // ---- Bluff Park, east of the store ---------------------------------
            var P = this.park;
            // gateway arch on the path from the plaza
            var black = this.brand(C.washed);
            this.box(0.4, 0.4, 4.2, 22.5, P.path_y - 2.2, DECK_Z, black, true);
            this.box(0.4, 0.4, 4.2, 22.5, P.path_y + 2.2, DECK_Z, black, true);
            this.box(0.5, 5.2, 0.9, 22.5, P.path_y, DECK_Z + 4.2, black, false);
            this.wallPlane(4.6, 0.75, this.textMaterial("BLUFF PARK", { fg : C.cream, w : 1024, h : 180, size : 0.8 }), 22.22, P.path_y, DECK_Z + 4.65, -Math.PI / 2);

            // pond: the logo's ring, with the logo standing in it
            var rim = new THREE.Mesh(new THREE.TorusBufferGeometry(P.pond_r, 0.45, 10, 64), this.brand(C.cream, { roughness : 0.6 }));
            rim.position.set(P.cx, P.cy, DECK_Z + 0.3);
            this.group.add(rim);
            var water = new THREE.Mesh(new THREE.CircleBufferGeometry(P.pond_r, 64),
                new THREE.MeshStandardMaterial({ color : new THREE.Color("#2f6f7a").convertSRGBToLinear(), roughness : 0.08, metalness : 0.3, transparent : true, opacity : 0.88 }));
            water.position.set(P.cx, P.cy, DECK_Z + 0.32);
            this.group.add(water);
            this.box(1.2, 1.2, 1.4, P.cx, P.cy, DECK_Z, this.brand(C.washed), false);
            var statue = new THREE.Group();
            statue.position.set(P.cx, P.cy, DECK_Z + 4.0);
            var face = new THREE.Mesh(new THREE.PlaneBufferGeometry(5.2, 5.2), this.logoMaterial(C.orange));
            face.rotation.x = Math.PI / 2;
            statue.add(face);
            this.group.add(statue);
            this.spinners.push(statue);
            // the pond blocks walking: 8 short wall pieces round the rim
            for (var a = 0; a < 12; a++)
            {
                var ang = a / 12 * Math.PI * 2;
                var q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
                this.collider(0.8, P.pond_r * 0.56, 1.6, new THREE.Vector3(P.cx + Math.cos(ang) * P.pond_r, P.cy + Math.sin(ang) * P.pond_r, DECK_Z + 0.8), q);
            }

            // trees on the lawns
            var greens = ["#2f5a36", "#3b6b3a", "#28503a", "#4a7340"];
            [[27, 28], [34, 34], [28, 40], [58, 28], [64, 36], [55, 36], [27, 52], [33, 60], [27, 65], [38, 66],
             [56, 54], [63, 60], [54, 65], [65, 50], [36, 27], [64, 27], [36, 54], [54, 27]].forEach((p, i) =>
            {
                this.tree(p[0], p[1], 0.85 + (i % 4) * 0.2, greens[i % greens.length]);
            });

            // benches round the pond and along the paths
            this.bench(P.cx - 10.2, P.cy + 5, Math.PI / 2);
            this.bench(P.cx + 10.2, P.cy - 5, -Math.PI / 2);
            this.bench(P.cx + 5, P.cy + 10.2, 0);
            this.bench(P.cx - 5, P.cy - 10.2, Math.PI);
            this.bench(30, P.path_y + 2.4, 0);
            this.bench(60, P.path_y + 2.4, 0);

            // flowers
            this.flowerBed(P.cx - 7.4, P.cy - 7.4, 2.6, 2.6);
            this.flowerBed(P.cx + 7.4, P.cy + 7.4, 2.6, 2.6);
            this.flowerBed(P.cx + 7.4, P.cy - 7.4, 2.6, 2.6);
            this.flowerBed(P.cx - 7.4, P.cy + 7.4, 2.6, 2.6);
            this.flowerBed(24.5, 30, 1.4, 8);

            // lamps
            [[26, P.path_y - 2], [36, P.path_y + 2], [54, P.path_y - 2], [64, P.path_y + 2],
             [P.cx - 2, 30], [P.cx + 2, 60], [P.cx + 2, 26], [P.cx - 2, 66]].forEach((p) => this.parkLamp(p[0], p[1]));

            // picnic lawn: a blanket and the bag left on it
            this.floorPlane(3.2, 2.4, this.brand(C.orange, { roughness : 0.95 }), 58, 60, DECK_Z + 0.07);
            var picnic = this.displayBag(C.olive, 58.4, 60.2, DECK_Z + 0.5, 0.03, 0.6, false);
            picnic.rotation.x = -1.2;
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
