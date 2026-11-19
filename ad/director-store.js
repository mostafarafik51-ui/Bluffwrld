// "Where did you get that?" — a short film made inside the game.
// Injected into the running game by ad/render.js (pass this file as the director).
// Every frame is a pure function of t (seconds), so frames can render in any order.
//
//   0.0  -  2.6  CHAT      friends chatting on the main street; she walks into shot
//   2.6  -  4.8  PASSING   she walks past, their heads turn to follow the bag
//   4.8  -  6.8  ASK       "where did you get that??"
//   6.8  -  8.8  POINT     she points up the street: the store is right there
//   8.8  - 12.4  STORE     a cinematic crane up the facade, then a glide inside
//  12.4  - 15.8  RUSH      everyone stampedes for the store
//  15.8  - 18.4  ALONE     she is left on the empty street
//  18.4  - 21.0  LOGO
(function ()
{
var maskReady = new Promise((ok) => { var im = new Image(); im.onload = ok; im.onerror = ok; im.src = "ad/crowd-headmask.png"; });
// the men: Ready Player Me's sample avatar from the three.js examples (js/models/man.glb)
var manReady = new Promise((ok) => require(["three", "gltfLoader"], (THREE) => new THREE.GLTFLoader().load("js/models/man.glb", ok, undefined, () => ok(null))));
Promise.all([maskReady, manReady]).then((loaded) => { var manGltf = loaded[1]; return manGltf; }).then((manGltf) =>
require(["three", "player", "renderer", "scene", "camera", "city", "terrain"],
        (THREE, Player, renderer, scene, camera, City, Terrain) =>
{
    var Z0 = City.DECK_Z;
    var ORANGE = "#ff4e00", CREAM = "#e8e3d8", WASHED = "#12110F";
    var MARK = "'Permanent Marker', 'Arial Black', sans-serif";
    var W = window.innerWidth, H = window.innerHeight;

    // ---- set the stage --------------------------------------------------------------------
    window.requestAnimationFrame = () => 0;
    var container = document.getElementById("threejs-container");
    for (var el of Array.from(document.body.children)) if (el !== container && el.tagName !== "SCRIPT") el.style.display = "none";
    for (var c of Array.from(container.children)) if (c !== renderer.domElement) c.style.display = "none";
    var overlay = document.createElement("canvas");
    overlay.width = W; overlay.height = H;
    overlay.style.cssText = "position:fixed;left:0;top:0;width:" + W + "px;height:" + H + "px;z-index:50;pointer-events:none";
    document.body.appendChild(overlay);
    var ctx = overlay.getContext("2d");
    camera.fov = 58; camera.aspect = W / H; camera.near = 0.05; camera.updateProjectionMatrix();
    // the blocky shop staff would look out of place next to real people
    City.npcs.forEach((n) => { n.group.visible = false; });

    // ---- helpers ---------------------------------------------------------------------------
    var clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    var lin = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
    var ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    var easeOut = (x) => 1 - Math.pow(1 - x, 3);
    var mix = (a, b, x) => a + (b - a) * x;
    var V = (x, y, z) => new THREE.Vector3(x, y, z);
    var lerpV = (a, b, x) => a.clone().lerp(b, x);
    var rand = (n) => { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    var wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    var worldOf = (o) => { var v = new THREE.Vector3(); o.getWorldPosition(v); return v; };

    // ---- people ----------------------------------------------------------------------------
    var clips = {};
    Player.model.animations.forEach((a) => { clips[a.name] = a; });

    // copy a skinned character so it gets its own skeleton
    var parallel = (a, b, fn) => { fn(a, b); for (var i = 0; i < a.children.length; i++) parallel(a.children[i], b.children[i], fn); };
    var cloneSkinned = (source) =>
    {
        var copy = source.clone(true), srcOf = new Map(), copyOf = new Map();
        parallel(source, copy, (a, b) => { srcOf.set(b, a); copyOf.set(a, b); });
        copy.traverse((n) =>
        {
            if (!n.isSkinnedMesh) return;
            var s = srcOf.get(n);
            n.skeleton = s.skeleton.clone();
            n.bindMatrix.copy(s.bindMatrix);
            n.skeleton.bones = s.skeleton.bones.map((b) => copyOf.get(b));
            n.bind(n.skeleton, n.bindMatrix);
        });
        return copy;
    };

    // outfit and skin variations, made by recolouring the character's texture
    var baseMesh = null;
    Player.threeObj.traverse((o) => { if (o.isSkinnedMesh && !baseMesh) baseMesh = o; });
    var baseMap = baseMesh.material.map;
    var hsv = (r, g, b) =>
    {
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
        if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
    };
    var rgb = (hex) => { var c = new THREE.Color(hex); return [c.r * 255, c.g * 255, c.b * 255]; };
    // where the head skin is in the texture (ad/crowd-headmask.png, 1024 x 1024): the skin
    // that was under her hair and glasses is unpainted grey, and gets painted with skin here
    var headMask = (() =>
    {
        var img = new Image(); img.src = "ad/crowd-headmask.png";
        return img;
    })();
    var headMaskData = null;
    var readHeadMask = () =>
    {
        if (headMaskData) return headMaskData;
        var c = document.createElement("canvas"); c.width = c.height = 1024;
        var g = c.getContext("2d"); g.drawImage(headMask, 0, 0);
        headMaskData = g.getImageData(0, 0, 1024, 1024).data;
        return headMaskData;
    };
    var outfit = (o) =>
    {
        var S = 2048, cv = document.createElement("canvas"); cv.width = cv.height = S;
        var g = cv.getContext("2d");
        g.drawImage(baseMap.image, 0, 0, S, S);
        var img = g.getImageData(0, 0, S, S), d = img.data;
        var pants = rgb(o.pants), top = rgb(o.top), acc = rgb(o.acc), hair = o.hair ? rgb(o.hair) : null;
        var mask = readHeadMask(), SK = [118, 78, 54];     // a mid skin tone, scaled per person below
        for (var i = 0; i < d.length; i += 4)
        {
            var r = d[i], gg = d[i + 1], b = d[i + 2], p = hsv(r, gg, b), h = p[0], s = p[1], v = p[2], col = null, k = 1;
            // the sunglasses' white frames live in this corner of the texture
            // leave the eyes alone (they sit in this corner of the texture)
            var px = (i / 4) % S, py = Math.floor(i / 4 / S);
            if (px > S * 0.955 && py > S * 0.925) continue;
            if (mask[((py >> 1) * 1024 + (px >> 1)) * 4] > 128 && s < 0.22)
            {
                var kk = 0.55 + v * 0.6;
                d[i] = Math.min(255, SK[0] * o.skin * kk); d[i + 1] = Math.min(255, SK[1] * o.skin * kk * 0.98); d[i + 2] = Math.min(255, SK[2] * o.skin * kk * 0.95);
                continue;
            }

            if (h > 38 && h < 72 && s > 0.4 && v > 0.45) { col = pants; k = v / 0.92; }
            else if (s < 0.2 && v > 0.33 && v < 0.97) { col = top; k = Math.min(1.15, v / 0.7); }
            else if ((h < 12 || h > 340) && s > 0.55 && v > 0.35) { col = acc; k = v / 0.85; }
            else if (h > 8 && h < 40 && s > 0.25 && s < 0.82 && v > 0.16 && v < 0.82)
            {
                d[i] = Math.min(255, r * o.skin); d[i + 1] = Math.min(255, gg * o.skin * 0.98); d[i + 2] = Math.min(255, b * o.skin * 0.95);
                continue;
            }
            else if (hair && v < 0.22) { col = hair; k = 0.25 + v * 3; }
            if (col) { d[i] = Math.min(255, col[0] * k); d[i + 1] = Math.min(255, col[1] * k); d[i + 2] = Math.min(255, col[2] * k); }
        }
        g.putImageData(img, 0, 0);
        var tex = new THREE.CanvasTexture(cv);
        tex.encoding = baseMap.encoding; tex.flipY = baseMap.flipY;
        tex.wrapS = baseMap.wrapS; tex.wrapT = baseMap.wrapT;
        var mat = baseMesh.material.clone();
        mat.map = tex;
        // no metallic sheen: it turns darker skin silver
        mat.metalness = 0; mat.metalnessMap = null; mat.roughnessMap = null; mat.roughness = 0.85;
        return mat;
    };
    var OUTFITS =
    [
        { pants : "#6E6B4E", top : "#e8e3d8", acc : "#12110F", skin : 1.55 },                       // 0 light skin, olive cargo
        { pants : "#12110F", top : "#B6521F", acc : "#6E6B4E", skin : 0.62 },                       // 1 deep skin, all black + rust
        { pants : "#3E6FA3", top : "#1c1b19", acc : "#ff4e00", skin : 1.2 },                        // 2 tan, denim blue
        { pants : "#9A968B", top : "#56467F", acc : "#6E6B4E", skin : 0.85 },                       // 3 brown, grey + violet
        { pants : "#B6521F", top : "#141312", acc : "#3E6FA3", skin : 1.75 },                       // 4 pale, rust pants
        { pants : "#D8CFBE", top : "#2f5a36", acc : "#B6521F", skin : 0.72 },                       // 5 dark, beige + forest
        { pants : "#1a1917", top : "#c22a1e", acc : "#ff4e00", skin : 1.35 },                       // 6 light-tan, black + red
        { pants : "#56467F", top : "#e9b949", acc : "#12110F", skin : 1.0 },                        // 7 mid, violet + mustard
    ].map(outfit);

    // ---- hair and headwear, built around each person's head and carried by the Head bone ----
    var HAIR_COLOURS = { black : "#15110e", brown : "#4a2f1e", auburn : "#7a3a1e", blonde : "#c9a46a", grey : "#9c978d", dyed : "#d9572c" };
    var hairMat = (c, rough) => new THREE.MeshStandardMaterial({ color : new THREE.Color(c).convertSRGBToLinear(), roughness : rough || 0.9 });
    var bumpy = (geo, amount, seed) =>
    {
        var pos = geo.attributes.position, v = new THREE.Vector3();
        for (var i = 0; i < pos.count; i++)
        {
            v.fromBufferAttribute(pos, i);
            var n = 1 + amount * (rand(Math.round(v.x * 50) * 7 + Math.round(v.y * 50) * 13 + Math.round(v.z * 50) * 17 + seed) - 0.5);
            pos.setXYZ(i, v.x * n, v.y * n, v.z * n);
        }
        geo.computeVertexNormals();
        return geo;
    };
    // style: crop | afro | cap | beanie | bun | long | braids | buzz
    var dressHead = (root, style, colour, extra, prefix) =>
    {
        root.updateMatrixWorld(true);
        prefix = prefix === undefined ? "mixamorig" : prefix;
        var head = root.getObjectByName(prefix + "Head"), top = root.getObjectByName(prefix + "HeadTop_End");
        var hp = worldOf(head), tp = worldOf(top), up = tp.clone().sub(hp), hl = up.length();
        up.normalize();
        var fwd = V(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).projectOnPlane(up).normalize();
        var right = new THREE.Vector3().crossVectors(up, fwd).normalize();
        var r = hl * 0.5, c = hp.clone().addScaledVector(up, hl * 0.62).addScaledVector(fwd, -hl * 0.08);
        // a frame on the head: x right, y up, z forward
        var g = new THREE.Group();
        g.position.copy(c);
        g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd))
            .multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -0.42));   // crown tipped back: hairline above the eyes
        var m = hairMat(HAIR_COLOURS[colour] || colour);
        var add = (geo, mat, x, y, z, sx, sy, sz) =>
        {
            var mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x * r, y * r, z * r);
            mesh.scale.set((sx || 1) * r, (sy || 1) * r, (sz || 1) * r);
            g.add(mesh);
            return mesh;
        };
        var cap = (k, theta) => new THREE.SphereBufferGeometry(k, 24, 16, 0, Math.PI * 2, 0, Math.PI * (theta || 0.58));
        // every style covers the scalp
        if (style == "buzz") add(cap(1.04, 0.6), m, 0, 0.02, -0.04);
        if (style == "crop" || style == "bun" || style == "long" || style == "braids") add(bumpy(cap(1.08, 0.62), 0.08, 3), m, 0, 0.03, -0.06, 1, 1.05, 1.05);
        if (style == "afro") add(bumpy(new THREE.IcosahedronBufferGeometry(1, 3), 0.18, 9), m, 0, 0.55, -0.35, 1.45, 1.25, 1.35);
        if (style == "bun") add(bumpy(new THREE.SphereBufferGeometry(0.5, 16, 12), 0.1, 5), m, 0, 1.15, -0.35);
        if (style == "long") add(bumpy(new THREE.SphereBufferGeometry(1, 20, 16), 0.05, 11), m, 0, -0.85, -0.55, 1.0, 1.6, 0.55);
        if (style == "braids")
        {
            for (var b = 0; b < 7; b++)
            {
                var a = -0.9 + b * 0.3;
                var br = add(new THREE.CylinderBufferGeometry(0.09, 0.07, 2.1, 6), m, Math.sin(a) * 0.95, -0.85, -0.55 + Math.cos(a) * -0.25);
            }
        }
        if (style == "cap")
        {
            var cm = hairMat(extra || "#12110F", 0.75);
            add(cap(1.1, 0.55), cm, 0, 0.05, -0.04);
            add(new THREE.CylinderBufferGeometry(0.95, 0.95, 0.06, 24, 1, false, -Math.PI / 2, Math.PI), cm, 0, 0.42, 0.55, 1, 1, 1.05);
            add(new THREE.SphereBufferGeometry(0.1, 8, 6), cm, 0, 1.12, -0.03);
        }
        if (style == "beanie")
        {
            var bm = hairMat(extra || "#B6521F", 0.95);
            add(bumpy(cap(1.12, 0.62), 0.03, 2), bm, 0, 0.12, -0.05, 1, 1.25, 1);
            add(new THREE.CylinderBufferGeometry(1.13, 1.13, 0.32, 24, 1, true), bm, 0, 0.18, -0.05);
        }
        scene.add(g);
        head.attach(g);       // from now on it moves with the head
        return g;
    };

    // the crowd's body: her mesh without the headphones, hair buns and sunglasses
    // (the vertex list comes from ad/crowd-hide.json, worked out from the model's separate pieces)
    var crowdGeometry = (() =>
    {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "ad/crowd-hide.json", false);
        xhr.send();
        var info = JSON.parse(xhr.responseText), hidden = new Uint8Array(baseMesh.geometry.attributes.position.count);
        info.hiddenVertexRanges.forEach((r) => { for (var v = r[0]; v <= r[1]; v++) hidden[v] = 1; });
        var geo = baseMesh.geometry.clone(), idx = geo.index.array, keep = [];
        for (var i = 0; i < idx.length; i += 3)
        {
            if (!hidden[idx[i]] && !hidden[idx[i + 1]] && !hidden[idx[i + 2]]) keep.push(idx[i], idx[i + 1], idx[i + 2]);
        }
        geo.setIndex(keep);
        return geo;
    })();

    // ---- the men -------------------------------------------------------------------------
    // her animations carried over to his skeleton (same bone names without the "mixamorig" prefix)
    // Her model was converted with a 90 degree turn above the hips; his was not. The hip
    // rotations are re-expressed in his skeleton's frame so he stands up.
    var relQ = (root, name) =>
    {
        root.updateMatrixWorld(true);
        var parent = root.getObjectByName(name).parent;
        var rq = root.getWorldQuaternion(new THREE.Quaternion()).inverse();
        return rq.multiply(parent.getWorldQuaternion(new THREE.Quaternion()));
    };
    var herParent = relQ(Player.threeObj, "mixamorigHips");
    var hisParent = manGltf ? relQ(manGltf.scene, "Hips") : new THREE.Quaternion();
    var hipFix = hisParent.clone().inverse().multiply(herParent);
    var manClips = {};
    Object.keys(clips).forEach((k) =>
    {
        var c = clips[k];
        var tracks = c.tracks.filter((tr) => /\.quaternion$/.test(tr.name)).map((tr) =>
        {
            var t2 = tr.clone();
            t2.name = tr.name.replace("mixamorig", "");
            if (t2.name == "Hips.quaternion")
            {
                var v = t2.values, q = new THREE.Quaternion();
                for (var i = 0; i < v.length; i += 4)
                {
                    q.set(v[i], v[i + 1], v[i + 2], v[i + 3]).premultiply(hipFix);
                    v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; v[i + 3] = q.w;
                }
            }
            return t2;
        });
        manClips[k] = new THREE.AnimationClip(k, c.duration, tracks);
    });
    var greyMap = (map) =>
    {
        if (!map || !map.image) return map;
        var w = map.image.width, h = map.image.height, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        var g = cv.getContext("2d"); g.drawImage(map.image, 0, 0);
        var img = g.getImageData(0, 0, w, h), d = img.data;
        for (var i = 0; i < d.length; i += 4) { var l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; l = Math.min(255, 40 + l * 1.15); d[i] = d[i + 1] = d[i + 2] = l; }
        g.putImageData(img, 0, 0);
        var t = new THREE.CanvasTexture(cv);
        t.encoding = map.encoding; t.flipY = map.flipY; t.wrapS = map.wrapS; t.wrapT = map.wrapT;
        return t;
    };
    var MAN_HEIGHT = 1.87, HER_HEIGHT = 0.95;
    var man = (o) =>
    {
        var root = cloneSkinned(manGltf.scene);
        var tint = (hex, k) => new THREE.Color(hex).convertSRGBToLinear().multiplyScalar(k || 1);
        root.traverse((n) =>
        {
            if (!n.isMesh) return;
            n.frustumCulled = false;
            var m = n.material.clone();
            var part = n.material.name;
            if (part == "Wolf3D_Headwear") n.visible = false;                          // the fedora goes
            else if (part == "Wolf3D_Beard") { n.visible = !!o.beard; m.color = tint(o.hairColourHex || "#2a1d14"); }
            else if (part == "Wolf3D_Skin" || part == "Wolf3D_Body") m.color = new THREE.Color(o.skin, o.skin * 0.97, o.skin * 0.93);
            else if (part == "Wolf3D_Outfit_Top") { m.map = greyMap(m.map); m.color = tint(o.top); }
            else if (part == "Wolf3D_Outfit_Bottom") { m.map = greyMap(m.map); m.color = tint(o.pants); }
            else if (part == "Wolf3D_Outfit_Footwear") { m.map = greyMap(m.map); m.color = tint(o.shoes || "#f1ede4"); }
            m.metalness = 0; m.roughness = 0.85;
            n.material = m;
        });
        var build = o.build || [1, 1], k = (o.size || 1) * HER_HEIGHT / MAN_HEIGHT * 1.07;
        root.scale.set(k * build[0], k * build[1], k * build[0]);
        root.rotation.set(Math.PI / 2, 0, 0);
        scene.add(root);
        root.position.copy(Player.threeObj.position);
        var mixer = new THREE.AnimationMixer(root), actions = {};
        Object.keys(manClips).forEach((c) => { actions[c] = mixer.clipAction(manClips[c]); });
        poseWith(mixer, actions, [["Idle", 0, 1]]);
        root.updateMatrixWorld(true);
        if (o.hairStyle) dressHead(root, o.hairStyle, o.hairColour || "black", o.hat, "");
        var p = Object.assign({ root : root, mixer : mixer, actions : actions, bone : (b) => root.getObjectByName(b) }, o);
        people.push(p);
        return p;
    };

    var people = [];
    var person = (o) =>
    {
        if (o.man && manGltf) return man(o);
        var root = cloneSkinned(Player.threeObj);
        var bag = root.getObjectByName("BluffBag");      // only she has the bag
        if (bag) bag.parent.remove(bag);
        root.traverse((n) => { if (n.isSkinnedMesh) { n.material = OUTFITS[o.look]; n.frustumCulled = false; if (o.hairStyle) n.geometry = crowdGeometry; } });
        // build: [width, height] of the body
        var build = o.build || [1, 1];
        root.scale.set((o.size || 1) * build[0], (o.size || 1) * build[1], (o.size || 1) * build[0]);
        scene.add(root);
        // dress the head in her current pose, so the hair sits on it
        root.position.copy(Player.threeObj.position); root.rotation.copy(Player.threeObj.rotation);
        if (o.hairStyle) dressHead(root, o.hairStyle, o.hairColour || "black", o.hat);
        var mixer = new THREE.AnimationMixer(root), actions = {};
        Object.keys(clips).forEach((k) => { actions[k] = mixer.clipAction(clips[k]); });
        var p = Object.assign({ root : root, mixer : mixer, actions : actions,
            bone : (n) => root.getObjectByName("mixamorig" + n) }, o);
        people.push(p);
        return p;
    };

    // pose helpers shared by everyone (the hero uses the game's own mixer)
    var poseWith = (mixer, actions, list) =>
    {
        mixer.stopAllAction();
        list.forEach((c) =>
        {
            var a = actions[c[0]], d = a.getClip().duration;
            a.enabled = true; a.setEffectiveTimeScale(1); a.setEffectiveWeight(c[2]); a.play();
            a.time = ((c[1] % d) + d) % d;
        });
        mixer.update(0);
    };
    var heroActions = {};
    Object.keys(Player.animator.animation_data).forEach((k) => { heroActions[k] = Player.animator.animation_data[k].action; });
    // yaw: the direction someone faces, as an angle on the ground (0 = east, PI/2 = north)
    var place = (root, x, y, yaw) =>
    {
        root.position.set(x, y, Z0 + 0.02);
        root.rotation.set(Math.PI / 2, Math.atan2(Math.cos(yaw), -Math.sin(yaw)), 0);
        root.updateMatrixWorld(true);
    };
    var yawTo = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

    // rotate a bone by a world-space rotation
    var applyWorld = (bone, q) =>
    {
        var wq = bone.getWorldQuaternion(new THREE.Quaternion());
        var pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
        bone.quaternion.copy(pq.inverse().multiply(q.multiply(wq)));
        bone.updateMatrixWorld(true);
    };
    // turn someone's head (and a little of the neck) towards a point
    var look = (who, bodyYaw, target, w, max) =>
    {
        if (w <= 0) return;
        var head = who.bone("Head"), neck = who.bone("Neck");
        var hp = worldOf(head);
        var ang = clamp(wrap(Math.atan2(target.y - hp.y, target.x - hp.x) - bodyYaw), -(max || 1.2), max || 1.2) * w;
        applyWorld(neck, new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), ang * 0.4));
        applyWorld(head, new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), ang * 0.6));
    };
    // swing a bone so its child lies on the line towards a target
    var aim = (bone, child, target, w) =>
    {
        if (w <= 0) return;
        var bw = worldOf(bone), cur = worldOf(child).sub(bw).normalize(), want = target.clone().sub(bw).normalize();
        var before = bone.quaternion.clone();
        applyWorld(bone, new THREE.Quaternion().setFromUnitVectors(cur, want));
        var after = bone.quaternion.clone();
        bone.quaternion.copy(before).slerp(after, w);
        bone.updateMatrixWorld(true);
    };

    // ---- the cast ---------------------------------------------------------------------------
    var hero = Player.threeObj;
    var hb = (n) => hero.getObjectByName("mixamorig" + n);
    var STORE = V(0, 26.7, Z0 + 2.4);                  // the store's door, what she points at
    var CIRCLE = V(1.55, 9.6, Z0);                     // where the friends stand
    var at = (ang, r) => V(CIRCLE.x + Math.cos(ang) * r, CIRCLE.y + Math.sin(ang) * r, Z0);

    var A = person({ name : "A", look : 0, size : 1.02, build : [1.0, 1.04], hairStyle : "long", hairColour : "blonde", p0 : at(0.15, 0.58), lane : 0.9, start : 12.55, idle : "IdleRelax", off : 1.3 });
    var B = person({ name : "B", look : 2, size : 0.97, build : [0.96, 1.0], hairStyle : "bun", hairColour : "brown", p0 : at(3.3, 0.55), lane : -0.4, start : 12.42, idle : "Idle", off : 0.4 });
    var C = person({ name : "C", man : true, beard : true, skin : 0.55, top : "#B6521F", pants : "#12110F", shoes : "#e8e3d8", look : 1, size : 1.08, build : [1.08, 1.0], hairStyle : "cap", hat : "#ff4e00", p0 : at(2.0, 0.56), lane : 0.3, start : 12.5, idle : "Idle", off : 1.1 });
    [A, B, C].forEach((p) => { p.yaw0 = yawTo(p.p0, CIRCLE); p.friend = true; });
    var extras =
    [
        { man : true, skin : 0.42, top : "#2f5a36", pants : "#1a1917", look : 3, size : 1.06, build : [1.1, 1.0], hairStyle : "buzz", hairColour : "black", p0 : V(3.45, 12.7, Z0), yaw0 : Math.PI,        lane : 1.0,  start : 12.6,  idle : "Idle",      off : 0.2 },
        { look : 4, size : 0.95, build : [0.92, 0.97], hairStyle : "crop", hairColour : "auburn", p0 : V(-3.3, 13.9, Z0), yaw0 : 0.5,            lane : -1.2, start : 12.75, idle : "IdleRelax", off : 3.0 },
        { man : true, beard : true, skin : 0.95, top : "#56467F", pants : "#9A968B", look : 5, size : 1.04, build : [1.15, 1.0], hairStyle : "beanie", hat : "#e9b949", hairColourHex : "#7a4a24", p0 : V(-2.95, 14.75, Z0), yaw0 : -2.4,         lane : -0.8, start : 12.8,  idle : "Idle",      off : 1.6 },
        { look : 6, size : 0.99, build : [1.0, 0.98], hairStyle : "braids", hairColour : "black", p0 : V(3.25, 16.6, Z0), yaw0 : -2.7,           lane : 0.6,  start : 12.9,  idle : "IdleRelax", off : 5.0 },
        { man : true, beard : true, skin : 0.75, top : "#12110F", pants : "#3E6FA3", look : 7, size : 1.08, build : [1.05, 1.0], hairStyle : "crop", hairColour : "brown", hairColourHex : "#3a2616", p0 : V(-6.6, 2.0, Z0),  yaw0 : 0.2,            lane : -0.1, start : 12.6,  idle : "Idle",      off : 0.9 },
        { look : 0, size : 0.96, build : [0.95, 0.95], hairStyle : "afro", hairColour : "dyed", p0 : V(6.2, 1.4, Z0),   yaw0 : 2.9,            lane : 0.45, start : 12.7,  idle : "Idle",      off : 0.5 },
        { man : true, skin : 0.6, top : "#e8e3d8", pants : "#6E6B4E", look : 5, size : 1.0, build : [1.0, 1.0], hairStyle : "cap", hat : "#3E6FA3", p0 : V(-4.6, 5.6, Z0),  yaw0 : -0.3,           lane : -1.0, start : 12.65, idle : "IdleRelax", off : 7.0 },
    ].map(person);
    var crowd = [A, B, C].concat(extras);

    // ---- the run to the store ---------------------------------------------------------------
    var RUNV = 4.2, DOOR_Y = 26.7, INSIDE_Y = 31.5;
    crowd.forEach((p) =>
    {
        // a path: off their spot, onto their lane of the main street, through the door, inside
        var pts = [p.p0.clone()];
        if (Math.abs(p.p0.x) > 3) pts.push(V(p.lane * 1.4, Math.max(p.p0.y + 1.5, 4.5), Z0));
        pts.push(V(p.lane, 18, Z0), V(p.lane * 0.8, DOOR_Y, Z0), V(p.lane * 0.5, INSIDE_Y, Z0));
        var len = [0];
        for (var i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
        p.path = pts; p.len = len;
    });
    var along = (p, dist) =>
    {
        var L = p.len, i = 1;
        while (i < L.length - 1 && L[i] < dist) i++;
        var a = p.path[i - 1], b = p.path[i], x = clamp((dist - L[i - 1]) / (L[i] - L[i - 1]), 0, 1);
        return { pos : lerpV(a, b, x), yaw : Math.atan2(b.y - a.y, b.x - a.x), done : dist >= L[L.length - 1] };
    };

    // ---- speech bubbles -------------------------------------------------------------------
    var bubble = (who, text, t, t0, t1, big) =>
    {
        if (t < t0 || t > t1) return;
        var head = worldOf(who.bone ? who.bone("HeadTop_End") : hb("HeadTop_End")).add(V(0, 0, 0.08));
        var p = head.clone().project(camera);
        if (p.z > 1) return;
        var x = (p.x + 1) / 2 * W, y = (1 - p.y) / 2 * H;
        var n = Math.max(1, Math.floor((t - t0) * 26));
        var shown = text.slice(0, n), pop = easeOut(lin(t, t0, t0 + 0.18)), fade = 1 - lin(t, t1 - 0.15, t1);
        var size = big ? 64 : 50;
        ctx.save();
        ctx.font = size + "px " + MARK;
        var tw = ctx.measureText(text).width * 1.1, bw = tw + 70, bh = size + 50;
        var bx = clamp(x - bw / 2, 30, W - 30 - bw), by = clamp(y - bh - 70, 40, H - bh - 40);
        ctx.globalAlpha = fade;
        ctx.translate(bx + bw / 2, by + bh); ctx.scale(pop, pop); ctx.translate(-(bx + bw / 2), -(by + bh));
        ctx.fillStyle = "#fbf8f1"; ctx.strokeStyle = WASHED; ctx.lineWidth = 6;
        ctx.beginPath();
        var r = 30;
        ctx.moveTo(bx + r, by); ctx.arcTo(bx + bw, by, bx + bw, by + bh, r); ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
        var tx = clamp(x, bx + 40, bx + bw - 40);
        ctx.lineTo(tx + 22, by + bh); ctx.lineTo(clamp(x, bx, bx + bw), by + bh + 48); ctx.lineTo(tx - 10, by + bh);
        ctx.arcTo(bx, by + bh, bx, by, r); ctx.arcTo(bx, by, bx + bw, by, r); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = WASHED; ctx.textBaseline = "middle"; ctx.textAlign = "left";
        ctx.fillText(shown, bx + 32, by + bh / 2 + 4);
        ctx.restore();
    };

    var finish = (frameNo) =>
    {
        var v = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.28, W / 2, H * 0.5, H * 0.72);
        v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.42)");
        ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
        for (var i = 0; i < 1400; i++)
        {
            ctx.fillStyle = rand(i + frameNo * 7.3) > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
            ctx.fillRect(rand(i * 3.1 + frameNo) * W, rand(i * 5.7 + frameNo * 1.3) * H, 2, 2);
        }
    };

    // ---- her movements ------------------------------------------------------------------
    var HERO_X = -0.75, WALK = 1.0, STOP_Y = 9.3;
    var heroY = (t) =>
    {
        var y = 4.25 + WALK * t;
        if (y < STOP_Y - 0.4) return y;
        // slows to a stop beside the friends
        var t1 = (STOP_Y - 0.4 - 4.25) / WALK, k = clamp((t - t1) / 0.8, 0, 1);
        return STOP_Y - 0.4 + 0.4 * (1 - Math.pow(1 - k, 2));
    };

    var placeHero = (t) =>
    {
        var y = heroY(t), pos = V(HERO_X, y, Z0);
        // walking north, then turning to face B, then back up the street when she points
        var north = Math.PI / 2, toB = yawTo(pos, B.p0);
        var yaw = north;
        if (t > 4.95) yaw = mix(north, toB, ease(lin(t, 4.95, 5.6)));
        if (t > 6.8) yaw = mix(toB, north - 0.35, ease(lin(t, 6.8, 7.3)));
        place(hero, pos.x, pos.y, yaw);
        var walkW = 1 - lin(t, 4.7, 5.3);
        var idle = t < 15.9 ? "Idle" : "IdleRelax";
        if (walkW > 0) poseWith(Player.animator.mixer, heroActions, [["Walk", t, walkW], ["Idle", t, 1 - walkW]]);
        else poseWith(Player.animator.mixer, heroActions, [[idle, t < 15.9 ? t : t - 15.9, 1]]);
        hero.updateMatrixWorld(true);
        // the point: right arm up the street at the store, held, then lowered
        var pw = ease(lin(t, 6.95, 7.45)) * (1 - ease(lin(t, 15.9, 16.5)));
        if (pw > 0)
        {
            aim(hb("RightArm"), hb("RightForeArm"), STORE, pw);
            aim(hb("RightForeArm"), hb("RightHand"), STORE, pw);
        }
        // she looks at B when asked, then up the street
        if (t > 5.0 && t < 6.9) look({ bone : hb }, yaw, B.p0.clone().setZ(Z0 + 1), lin(t, 5.0, 5.4), 1.0);
        if (t >= 6.9) look({ bone : hb }, yaw, STORE, lin(t, 6.9, 7.3) * (1 - lin(t, 15.9, 16.4)), 0.8);
        return pos;
    };

    var placeCrowd = (t, heroPos) =>
    {
        crowd.forEach((p, i) =>
        {
            var off = p.off || 0;
            if (t < p.start)
            {
                var yaw = p.yaw0;
                // B turns to her when asking
                if (p === B && t > 4.6) yaw = mix(p.yaw0, yawTo(p.p0, heroPos), ease(lin(t, 4.6, 5.3)));
                place(p.root, p.p0.x, p.p0.y, yaw);
                p.root.visible = true;
                poseWith(p.mixer, p.actions, [[p.idle, t + off, 1]]);
                p.root.updateMatrixWorld(true);
                // who they look at
                if (p.friend)
                {
                    var talker = p === A ? C.p0 : A.p0;
                    var wHero = lin(t, 2.9 + i * 0.12, 3.4 + i * 0.12) * (1 - lin(t, 7.1, 7.5));
                    var wStore = lin(t, 7.15 + i * 0.1, 7.55 + i * 0.1);
                    if (wStore > 0) look(p, yaw, STORE, wStore, 1.4);
                    else if (wHero > 0) look(p, yaw, heroPos.clone().setZ(Z0 + 0.6), wHero, 1.4);
                    else look(p, yaw, talker.clone().setZ(Z0 + 0.9), 0.8, 0.9);
                }
                else if (t > 7.3) look(p, yaw, STORE, lin(t, 7.3 + i * 0.1, 7.8 + i * 0.1), 1.3);
            }
            else
            {
                var dt = t - p.start, dist = RUNV * Math.max(0, dt - 0.18 * (1 - Math.exp(-dt / 0.18)));
                var a = along(p, dist);
                p.root.visible = !a.done;
                var yaw2 = mix(p.yaw0, p.yaw0 + wrap(a.yaw - p.yaw0), ease(lin(dt, 0, 0.3)));
                place(p.root, a.pos.x, a.pos.y, yaw2);
                poseWith(p.mixer, p.actions, [["Run", dt * 1.15 + off, 1]]);
            }
        });
    };

    // ---- the frame -------------------------------------------------------------------------
    var frame = (t, frameNo) =>
    {
        ctx.clearRect(0, 0, W, H);
        renderer.domElement.style.visibility = "visible";
        City.spinners.forEach((s, i) => { s.rotation.z = i * 1.3 + t * 0.6; });
        camera.up.set(0, 0, 1);

        if (t >= 18.4)
        {
            renderer.domElement.style.visibility = "hidden";
            ctx.fillStyle = WASHED; ctx.fillRect(0, 0, W, H);
            var e = lin(t, 18.5, 19.3), size = W * 0.6 * mix(0.94, 1, easeOut(e));
            if (City.logo_image && e > 0)
            {
                var tmp = document.createElement("canvas"); tmp.width = tmp.height = Math.round(size);
                City.drawLogo(tmp.getContext("2d"), City.logo_image, 0, 0, size, CREAM);
                var vis = size * easeOut(e);
                ctx.drawImage(tmp, 0, size - vis, size, vis, (W - size) / 2, H * 0.46 - size / 2 + (size - vis), size, vis);
            }
            return;
        }

        var hp = placeHero(t);
        placeCrowd(t, hp);
        var headOf = (p) => worldOf(p.bone("Head"));

        if (t < 2.6)
        {
            var a = ease(lin(t, 0, 2.6));
            camera.position.copy(lerpV(V(3.75, 6.2, Z0 + 0.95), V(3.35, 6.8, Z0 + 0.92), a));
            camera.lookAt(V(1.15, 9.7, Z0 + 0.72));
        }
        else if (t < 4.8)
        {
            // over the friends' shoulders, watching her walk past
            camera.position.set(2.6, 13.2, Z0 + 1.5);
            camera.lookAt(hp.clone().add(V(0.3, 0.6, 0.55)));
        }
        else if (t < 6.8)
        {
            var b = lin(t, 4.8, 6.8);
            camera.position.copy(lerpV(V(-2.25, 8.25, Z0 + 0.92), V(-2.05, 8.5, Z0 + 0.9), b));
            camera.lookAt(headOf(B).add(V(0, 0, -0.12)));
        }
        else if (t < 8.8)
        {
            var c = ease(lin(t, 6.8, 8.8));
            // behind her right shoulder, along the pointing arm
            camera.position.copy(lerpV(V(0.25, 6.4, Z0 + 1.05), V(0.1, 6.95, Z0 + 1.05), c));
            camera.lookAt(lerpV(V(-0.3, 20, Z0 + 1.6), V(0, 26.7, Z0 + 2.8), c));
        }
        else if (t < 10.6)
        {
            // the store: low, slow crane up the facade towards the bag on the roof
            var d = ease(lin(t, 8.8, 10.6));
            camera.position.copy(lerpV(V(-4.6, 18.6, Z0 + 0.2), V(-2.7, 20.8, Z0 + 1.6), d));
            camera.lookAt(lerpV(V(0, 26.7, Z0 + 3.2), V(0, 27.5, Z0 + 7.2), d));
        }
        else if (t < 12.4)
        {
            // through the doors and inside, drifting past the centre case
            var e2 = ease(lin(t, 10.6, 12.4));
            camera.position.copy(lerpV(V(0.95, 24.6, Z0 + 1.25), V(-0.75, 30.2, Z0 + 1.45), e2));
            camera.lookAt(lerpV(V(0.2, 33.5, Z0 + 1.6), V(-2.2, 35.5, Z0 + 1.7), e2));
        }
        else if (t < 15.8)
        {
            // the rush, from the store's doorstep
            var f = lin(t, 12.4, 15.8);
            camera.position.set(2.05, 23.3 + 0.2 * f, Z0 + 0.3);
            camera.lookAt(V(-0.3, 12.5, Z0 + mix(1.0, 0.85, f)));
        }
        else
        {
            var g = ease(lin(t, 15.8, 18.4));
            camera.position.copy(lerpV(V(-1.7, 5.3, Z0 + 1.05), V(-1.45, 6.4, Z0 + 1.0), g));
            camera.lookAt(V(-0.35, 20.5, Z0 + 1.7));
        }

        camera.updateMatrixWorld(true);
        Terrain.update();
        renderer.render(scene, camera);

        finish(frameNo);
    };

    window.AD = { frame : frame, DURATION : 21.0, ready : true, people : people, OUTFITS : OUTFITS };
}));
})();
