// Bluff ad director.
// Injected into the running game by ad/render.js. It stops the game loop and turns the
// world into a film set: every frame is a pure function of the time t (seconds), so
// frames can be rendered in any order and by several browsers at once.
//
// Shots (16 s, vertical 9:16):
//   0.0  -  3.2  STREET   she walks up the main street, leaving orange footprints
//   3.2  -  6.4  THE BAG  close on her back, callout lines draw onto the bag
//   6.4  - 10.4  RING     an orange ring blasts from her feet, she breaks into a breakdance
//  10.4  - 13.4  REVEAL   the camera cranes overhead as the logo paints itself around her
//  13.4  - 16.0  LOGO     the logo alone
(function ()
{
require(["three", "player", "renderer", "scene", "camera", "city", "terrain"],
        (THREE, Player, renderer, scene, camera, City, Terrain) =>
{
    var Z0 = City.DECK_Z, K = City.SCALE;
    var ORANGE = "#ff4e00", CREAM = "#e8e3d8", WASHED = "#12110F";
    var MARK = "'Permanent Marker', 'Arial Black', sans-serif";
    var MONO = "'IBM Plex Mono', 'Courier New', monospace";
    var W = window.innerWidth, H = window.innerHeight;
    var DURATION = 16.0;

    // ---- stop the game and clear its interface ----------------------------------------
    window.requestAnimationFrame = () => 0;
    var container = document.getElementById("threejs-container");
    for (var el of Array.from(document.body.children))
    {
        if (el !== container && el.tagName !== "SCRIPT") el.style.display = "none";
    }
    // the game's fps meters live inside the container too
    for (var c of Array.from(container.children)) if (c !== renderer.domElement) c.style.display = "none";
    var overlay = document.createElement("canvas");
    overlay.width = W; overlay.height = H;
    overlay.style.cssText = "position:fixed;left:0;top:0;width:" + W + "px;height:" + H + "px;z-index:50;pointer-events:none";
    document.body.appendChild(overlay);
    var ctx = overlay.getContext("2d");

    camera.fov = 58;
    camera.aspect = W / H;
    camera.near = 0.05;
    camera.updateProjectionMatrix();

    // ---- helpers -----------------------------------------------------------------------
    var clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    var lin = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
    var ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    var easeOut = (x) => 1 - Math.pow(1 - x, 3);
    var mix = (a, b, x) => a + (b - a) * x;
    var V = (x, y, z) => new THREE.Vector3(x, y, z);
    var rand = (n) => { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

    var flat = (map, w, h, opacity) =>
    {
        var m = new THREE.Mesh(new THREE.PlaneBufferGeometry(w, h),
            new THREE.MeshBasicMaterial({ map : map, color : map ? 0xffffff : new THREE.Color(ORANGE).convertSRGBToLinear(),
                transparent : true, opacity : opacity === undefined ? 1 : opacity, depthWrite : false }));
        m.renderOrder = 5;
        scene.add(m);
        return m;
    };
    var canvasTex = (w, h, draw) =>
    {
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var g = c.getContext("2d"); draw(g, w, h);
        var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
        t.userData = { canvas : c, ctx : g };
        return t;
    };

    // ---- the character -----------------------------------------------------------------
    var hero = Player.threeObj;
    var data = Player.animator.animation_data;
    var mixer = Player.animator.mixer;
    var bone = (n) => hero.getObjectByName("mixamorig" + n);

    // blend of clips: [[name, clipTime, weight], ...]
    var pose = (list) =>
    {
        mixer.stopAllAction();
        list.forEach((c) =>
        {
            var a = data[c[0]].action, d = a.getClip().duration;
            a.enabled = true;
            a.setEffectiveTimeScale(1);
            a.setEffectiveWeight(c[2]);
            a.play();
            a.time = c[1] % d;
        });
        mixer.update(0);
    };
    var place = (x, y, faceX, faceY) =>
    {
        hero.position.set(x, y, Z0 + 0.02);
        hero.rotation.set(Math.PI / 2, Math.atan2(faceX, -faceY), 0);
        hero.updateMatrixWorld(true);
    };
    var worldOf = (obj) => { var v = new THREE.Vector3(); obj.getWorldPosition(v); return v; };

    // walking path for the first two shots (north up the main street)
    var WALK_SPEED = 0.78, STEP = 0.535;
    var walkPos = (t) => V(0.62, -15.5 + WALK_SPEED * t, Z0);

    // ---- ground graphics: footprints, ring, logo ------------------------------------------
    var printTex = canvasTex(64, 128, (g, w, h) =>
    {
        var grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
        grd.addColorStop(0, "rgba(255,160,90,1)"); grd.addColorStop(0.55, "rgba(255,78,0,0.95)"); grd.addColorStop(1, "rgba(255,78,0,0)");
        g.fillStyle = grd;
        g.save(); g.translate(w / 2, h * 0.36); g.scale(1, 1.25); g.beginPath(); g.arc(0, 0, w * 0.42, 0, Math.PI * 2); g.fill(); g.restore();
        g.save(); g.translate(w / 2, h * 0.8); g.beginPath(); g.arc(0, 0, w * 0.3, 0, Math.PI * 2); g.fill(); g.restore();
    });
    var prints = [];
    var PRINTS = 22, PRINT_START = -4.6;     // she was already walking before the film starts
    for (var k = 0; k < PRINTS; k++) prints.push(flat(printTex, 0.24, 0.5, 0));

    var rings = [0, 1, 2].map((i) =>
    {
        var m = new THREE.Mesh(new THREE.RingBufferGeometry(i ? 0.985 : 0.972, 1, 128),
            new THREE.MeshBasicMaterial({ color : new THREE.Color(i ? CREAM : ORANGE).convertSRGBToLinear(), transparent : true, opacity : 0, depthWrite : false }));
        m.renderOrder = 6;
        scene.add(m);
        return m;
    });
    var glowDisc = flat(canvasTex(256, 256, (g, w, h) =>
    {
        var grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        grd.addColorStop(0, "rgba(255,120,40,0.9)"); grd.addColorStop(1, "rgba(255,78,0,0)");
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
    }), 1, 1, 0);

    var LOGO_SIZE = 11.2 * K;                 // same square as the logo painted on the roundabout
    var logoTex = canvasTex(1024, 1024, () => {});
    var logoPlane = flat(logoTex, LOGO_SIZE, LOGO_SIZE, 1);
    logoPlane.position.set(0, 0, Z0 + 0.07);
    var tinted = null;                        // the logo in orange, made once
    var paintLogo = (p, glow) =>
    {
        var g = logoTex.userData.ctx, S = 1024;
        g.clearRect(0, 0, S, S);
        if (!City.logo_image || p <= 0) { logoTex.needsUpdate = true; return; }
        if (!tinted)
        {
            tinted = document.createElement("canvas"); tinted.width = tinted.height = S;
            City.drawLogo(tinted.getContext("2d"), City.logo_image, 0, 0, S, ORANGE);
        }
        // spreads outwards from her feet (the centre), with a bright wet edge
        var r = S * 0.75 * p;
        g.save();
        g.beginPath(); g.arc(S / 2, S / 2, r, 0, Math.PI * 2); g.clip();
        g.drawImage(tinted, 0, 0);
        if (p < 1)
        {
            g.globalCompositeOperation = "source-atop";
            var band = g.createRadialGradient(S / 2, S / 2, Math.max(0, r - 70), S / 2, S / 2, r);
            band.addColorStop(0, "rgba(255,240,220,0)"); band.addColorStop(1, "rgba(255,240,220,1)");
            g.fillStyle = band; g.fillRect(0, 0, S, S);
        }
        g.restore();
        logoPlane.material.opacity = glow;
        logoTex.needsUpdate = true;
    };

    // ---- overlay graphics ------------------------------------------------------------------
    var typed = (str, t, t0, cps) => str.slice(0, Math.max(0, Math.floor((t - t0) * cps)));
    var bigText = (lines, x, y, size, alpha, color, align) =>
    {
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = size + "px " + MARK;
        ctx.textAlign = align || "left"; ctx.textBaseline = "alphabetic";
        ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
        lines.forEach((l, i) => { ctx.fillStyle = color || CREAM; ctx.fillText(l, x, y + i * size * 1.02); });
        ctx.restore();
    };
    var monoText = (str, x, y, size, alpha, color, align, spacing) =>
    {
        if (alpha <= 0 || !str) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = "600 " + size + "px " + MONO;
        ctx.letterSpacing = (spacing === undefined ? 4 : spacing) + "px";
        ctx.textAlign = align || "left"; ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12;
        ctx.fillStyle = color || CREAM;
        ctx.fillText(str, x, y);
        ctx.restore();
    };
    var screenOf = (v) => { var p = v.clone().project(camera); return { x : (p.x + 1) / 2 * W, y : (1 - p.y) / 2 * H, front : p.z < 1 }; };

    // a label that draws a line from a point on the bag out to a tag
    var callout = (anchor, side, dy, label, sub, t, t0) =>
    {
        var p = lin(t, t0, t0 + 0.45);
        if (p <= 0 || !anchor.front) return;
        var ex = clamp(anchor.x + side * 230, 70, W - 70), ey = anchor.y + dy;
        var lx = clamp(ex + side * 60, 40, W - 40);
        ctx.save();
        // anchor dot with a pulse
        ctx.fillStyle = ORANGE;
        ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 9, 0, Math.PI * 2); ctx.fill();
        var pulse = ((t - t0) % 1.1) / 1.1;
        ctx.strokeStyle = "rgba(255,78,0," + (1 - pulse) + ")"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 9 + pulse * 26, 0, Math.PI * 2); ctx.stroke();
        // line: anchor -> elbow -> end
        var seg1 = Math.hypot(ex - anchor.x, ey - anchor.y), seg2 = Math.abs(lx - ex), total = seg1 + seg2, drawn = total * easeOut(p);
        ctx.strokeStyle = ORANGE; ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y);
        if (drawn <= seg1) ctx.lineTo(mix(anchor.x, ex, drawn / seg1), mix(anchor.y, ey, drawn / seg1));
        else { ctx.lineTo(ex, ey); ctx.lineTo(mix(ex, lx, (drawn - seg1) / seg2), ey); }
        ctx.stroke();
        ctx.restore();
        // tag
        var q = lin(t, t0 + 0.35, t0 + 0.75);
        if (q > 0)
        {
            ctx.save();
            ctx.font = "600 34px " + MONO; ctx.letterSpacing = "4px";
            var txt = typed(label, t, t0 + 0.35, 28);
            ctx.font = "500 24px " + MONO; var sw = sub ? ctx.measureText(sub).width : 0;
            ctx.font = "600 34px " + MONO;
            var bw = Math.max(ctx.measureText(label).width, sw) + 44, bh = sub ? 104 : 66;
            var bx = clamp(side > 0 ? lx : lx - bw, 36, W - 36 - bw), by = ey - 33;
            ctx.globalAlpha = q;
            ctx.fillStyle = "rgba(18,17,15,0.88)"; ctx.fillRect(bx, by, bw, bh);
            ctx.strokeStyle = ORANGE; ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh);
            ctx.fillStyle = CREAM; ctx.textBaseline = "middle"; ctx.fillText(txt, bx + 22, by + 33);
            if (sub) { ctx.font = "500 24px " + MONO; ctx.fillStyle = ORANGE; ctx.fillText(typed(sub, t, t0 + 0.6, 30), bx + 22, by + 76); }
            ctx.restore();
        }
    };

    var finish = (t, frame) =>
    {
        // vignette and a little film grain, on every shot but the end card
        var v = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.28, W / 2, H * 0.5, H * 0.72);
        v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.45)");
        ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
        for (var i = 0; i < 1400; i++)
        {
            ctx.fillStyle = rand(i + frame * 7.3) > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
            ctx.fillRect(rand(i * 3.1 + frame) * W, rand(i * 5.7 + frame * 1.3) * H, 2, 2);
        }
    };

    // ---- the frame -------------------------------------------------------------------------
    var frame = (t, frameNo) =>
    {
        ctx.clearRect(0, 0, W, H);
        renderer.domElement.style.visibility = "visible";

        // world animation that would normally tick on its own
        City.spinners.forEach((s, i) => { s.rotation.z = i * 1.3 + t * 0.6; });

        // defaults
        prints.forEach((m) => { m.material.opacity = 0; });
        rings.forEach((m) => { m.material.opacity = 0; });
        glowDisc.material.opacity = 0;
        paintLogo(0, 0);
        camera.up.set(0, 0, 1);

        if (t < 6.4)
        {
            // ---- STREET + THE BAG: walking north ------------------------------------------
            var pos = walkPos(t);
            place(pos.x, pos.y, 0, 1);
            pose([["Walk", t, 1]]);

            // footprints left behind, alternating feet
            prints.forEach((m, k) =>
            {
                var ts = PRINT_START + k * STEP, age = t - ts;
                if (age < 0) return;
                var at = walkPos(ts);
                m.position.set(at.x + (k % 2 ? 0.1 : -0.1), at.y + 0.05, Z0 + 0.04);
                m.material.opacity = clamp(1 - age / 6.5, 0, 1) * clamp(age / 0.12, 0, 1);
            });

            if (t < 3.2)
            {
                // low, in front of her, slowly pulling back
                var a = lin(t, 0, 3.2);
                camera.position.set(pos.x + 0.55 - 0.25 * a, pos.y + 2.5 + 0.35 * ease(a), Z0 + 0.62 + 0.14 * a);
                camera.lookAt(V(pos.x, pos.y, Z0 + 0.62));
            } else
            {
                // close behind her left shoulder, pushing in on the bag
                var b = lin(t, 3.2, 6.4), back = worldOf(bone("Spine1"));
                camera.position.set(pos.x - 0.95 + 0.35 * ease(b), pos.y - 1.45 + 0.4 * ease(b), Z0 + 0.95 - 0.05 * b);
                camera.lookAt(back.clone().add(V(0.0, 0.0, 0.03)));
            }
        }
        else if (t < 13.4)
        {
            // ---- RING + REVEAL: at the roundabout ---------------------------------------------
            place(0, 0, 0, -1);
            var dance = t - 7.35;
            if (dance < 0) pose([["Idle", t - 6.4, 1]]);
            else if (dance < 0.35) pose([["Idle", t - 6.4, 1 - dance / 0.35], ["BreakDance", dance, dance / 0.35]]);
            else pose([["BreakDance", dance, 1]]);

            // the ring: one shockwave that stays as the logo's ring, two echoes
            var R = 7 * K;
            [[7.05, R, 0.95, 1.0], [7.2, R * 1.45, 0.7, 0.9], [7.38, R * 1.9, 0.5, 0.8]].forEach((s, i) =>
            {
                var p = lin(t, s[0], s[0] + s[3]);
                if (p <= 0) return;
                var r = Math.max(0.05, s[1] * easeOut(p));
                rings[i].scale.set(r, r, 1);
                rings[i].position.set(0, 0, Z0 + 0.05 + i * 0.002);
                rings[i].material.opacity = i == 0 ? s[2] : s[2] * (1 - p);
            });
            var g = lin(t, 7.0, 7.9);
            if (g > 0 && g < 1)
            {
                var gr = 1 + 9 * easeOut(g);
                glowDisc.scale.set(gr, gr, 1);
                glowDisc.position.set(0, 0, Z0 + 0.045);
                glowDisc.material.opacity = 0.85 * (1 - g);
            }

            var head = worldOf(bone("Spine2"));
            if (t < 10.4)
            {
                // orbit while she dances
                var c = lin(t, 6.4, 10.4), ang = mix(-2.35, -0.75, ease(c)), rad = mix(3.2, 4.3, c);
                camera.position.set(Math.cos(ang) * rad, Math.sin(ang) * rad, Z0 + mix(0.9, 1.45, c));
                camera.lookAt(V(0, 0, Z0 + 0.45));
            } else
            {
                // crane straight up and look down on the logo she is standing in
                var lt = lin(t, 10.4, 12.9), d = ease(lt), up = easeOut(lt);
                var ang2 = -0.75, rad2 = mix(4.3, 0.02, d);
                camera.position.set(Math.cos(ang2) * rad2, Math.sin(ang2) * rad2, Z0 + mix(1.45, 13.5, up));
                camera.up.set(0, 0, 1).lerp(V(0, 1, 0), d).normalize();
                camera.lookAt(V(0, 0, Z0 + mix(0.45, 0, d)));
                paintLogo(easeOut(lin(t, 10.7, 12.4)), 1);
            }
        }
        else
        {
            // ---- LOGO ---------------------------------------------------------------------
            renderer.domElement.style.visibility = "hidden";
            ctx.fillStyle = WASHED; ctx.fillRect(0, 0, W, H);
            var e = lin(t, 13.5, 14.35), size = W * 0.6 * mix(0.94, 1, easeOut(e));
            if (City.logo_image && e > 0)
            {
                var tmp = document.createElement("canvas"); tmp.width = tmp.height = Math.round(size);
                City.drawLogo(tmp.getContext("2d"), City.logo_image, 0, 0, size, CREAM);
                var visible = size * easeOut(e);           // paints in from the bottom
                ctx.drawImage(tmp, 0, size - visible, size, visible, (W - size) / 2, H * 0.46 - size / 2 + (size - visible), size, visible);
            }
            return;
        }

        // world camera done: let the terrain follow it, then draw
        camera.updateMatrixWorld(true);
        Terrain.update();
        renderer.render(scene, camera);

        // ---- type and graphics over the picture ----------------------------------------------
        if (t < 3.2)
        {
            monoText("MONDAY  08:59", 70, 140, 30, lin(t, 0.2, 0.5) * (1 - lin(t, 2.9, 3.15)), CREAM);
            monoText("BLUFF / BATCH 01", W - 70, 140, 30, lin(t, 0.35, 0.65) * (1 - lin(t, 2.9, 3.15)), ORANGE, "right");
            var out = 1 - lin(t, 2.85, 3.15);
            bigText([typed("lower your", t, 0.55, 16)], 70, H * 0.78, 128, out);
            bigText([typed("voice.", t, 1.25, 12)], 70, H * 0.78 + 130, 128, out, ORANGE);
        }
        else if (t < 6.4)
        {
            var strap = screenOf(worldOf(bone("RightShoulder")).add(V(0, -0.04, 0.02)));
            var pouch = screenOf(worldOf(bone("Spine")).add(V(-0.06, -0.08, -0.02)));
            var zip = screenOf(worldOf(bone("Spine1")).add(V(0.02, -0.09, 0.05)));
            callout(pouch, -1, -260, "THE CRESCENT", "AUTONOMOUS CARRY RELEASE", t, 3.55);
            callout(strap, 1, -150, "BATCH 01", "ONE WIDE STRAP. NO EXPLANATION.", t, 4.25);
            callout(zip, 1, 300, "900 EGP", "FREE DELIVERY", t, 4.95);
            monoText("THE INSIDE? NOT OUR THING.", W / 2, H - 150, 28, lin(t, 5.4, 5.7), CREAM, "center");
        }
        else if (t < 10.4)
        {
            var flash = 1 - lin(t, 7.05, 7.35);
            if (t > 7.05 && flash > 0) { ctx.fillStyle = "rgba(255,120,40," + 0.35 * flash + ")"; ctx.fillRect(0, 0, W, H); }
            var o = lin(t, 7.9, 8.2) * (1 - lin(t, 10.05, 10.35));
            bigText(["loud is"], W / 2, H * 0.17, 140, o, CREAM, "center");
            bigText(["a bluff."], W / 2, H * 0.17 + 145, 140, o * lin(t, 8.3, 8.5), ORANGE, "center");
        }
        else
        {
            monoText("NOTHING TO PROVE.", W / 2, H - 170, 34, lin(t, 12.4, 12.8), CREAM, "center", 8);
        }
        finish(t, frameNo);
    };

    window.AD = { frame : frame, DURATION : DURATION, ready : true };
});
})();
