// Bluff ad director.
// Injected into the running game by ad/render.js. It stops the game loop and turns the
// world into a film set: every frame is a pure function of the time t (seconds), so
// frames can be rendered in any order and by several browsers at once.
//
// No words, no product talk: a run of action that hooks the viewer, then the logo.
// Shots (15 s, vertical 9:16):
//   0.0  -  1.6  DROP     she falls out of the sky and slams onto the street
//   1.6  -  3.6  SPRINT   she runs up the main street, camera tracking alongside
//   3.6  -  5.5  LEAP     a huge jump over the camera, slow motion in the middle
//   5.5  -  9.4  DANCE    she lands in the roundabout and breaks into a breakdance
//   9.4  - 12.4  REVEAL   the camera cranes overhead: she is dancing on the logo
//  12.4  - 15.0  LOGO     the logo alone
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
    var DURATION = 15.0;

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

    // ---- motion helpers ----------------------------------------------------------------------
    // camera shake after an impact at time t0
    var shake = (t, t0, amount) =>
    {
        var a = t - t0;
        if (a < 0 || a > 0.6) return V(0, 0, 0);
        var k = amount * Math.pow(1 - a / 0.6, 2);
        return V(Math.sin(a * 91) * k, Math.cos(a * 77) * k * 0.6, Math.sin(a * 113 + 1) * k);
    };
    // dust burst on the ground at (x, y) starting at t0
    var burst = (t, t0, x, y, size) =>
    {
        [[0, 1.0, 0.9], [0.08, 1.5, 0.6], [0.16, 2.0, 0.4]].forEach((s, i) =>
        {
            var p = lin(t, t0 + s[0], t0 + s[0] + 0.7);
            if (p <= 0 || p >= 1) return;
            var r = Math.max(0.05, size * s[1] * easeOut(p));
            rings[i].scale.set(r, r, 1);
            rings[i].position.set(x, y, Z0 + 0.05 + i * 0.002);
            rings[i].material.color.set(new THREE.Color(CREAM).convertSRGBToLinear());
            rings[i].material.opacity = s[2] * (1 - p);
        });
        var g = lin(t, t0, t0 + 0.5);
        if (g > 0 && g < 1)
        {
            var gr = size * (0.8 + 3 * easeOut(g));
            glowDisc.scale.set(gr, gr, 1);
            glowDisc.position.set(x, y, Z0 + 0.045);
            glowDisc.material.opacity = 0.7 * (1 - g);
        }
    };
    var flashes = [];      // [time, strength]
    var aim = (pos, target, jolt) =>
    {
        camera.position.copy(pos).add(jolt || V(0, 0, 0));
        camera.lookAt(target);
    };

    // the run and the leap share one path up the main street
    var RUN = 3.7, RUN_T0 = 1.6, RUN_Y0 = -14.0;
    var runY = (t) => RUN_Y0 + RUN * (t - RUN_T0);
    var TAKEOFF = 3.9, LANDING = 5.5;
    var leap = (t) =>
    {
        // speed ramp: quick off the ground, slow at the top, quick into the landing
        var x = lin(t, TAKEOFF, LANDING);
        var s = x - 0.6 * Math.sin(2 * Math.PI * x) / (2 * Math.PI);
        var y0 = runY(TAKEOFF);
        return { s : s, pos : V(mix(0.62, 0, s), mix(y0, 0, s), Z0 + 0.02 + 4 * 2.1 * s * (1 - s)) };
    };

    // ---- the frame -------------------------------------------------------------------------
    var frame = (t, frameNo) =>
    {
        ctx.clearRect(0, 0, W, H);
        renderer.domElement.style.visibility = "visible";
        City.spinners.forEach((s, i) => { s.rotation.z = i * 1.3 + t * 0.6; });

        prints.forEach((m) => { m.material.opacity = 0; });
        rings.forEach((m) => { m.material.opacity = 0; });
        glowDisc.material.opacity = 0;
        paintLogo(0, 0);
        camera.up.set(0, 0, 1);
        var flash = 0;

        if (t < 1.6)
        {
            // ---- DROP -----------------------------------------------------------------
            var LAND = 0.62, x = 0.62, y = RUN_Y0;
            var z = t < LAND ? Z0 + 0.02 + 5.0 * (1 - Math.pow(t / LAND, 2)) : Z0 + 0.02;
            hero.position.set(x, y, z);
            hero.rotation.set(Math.PI / 2, Math.atan2(0, -1), 0);
            hero.updateMatrixWorld(true);
            if (t < LAND) pose([["FallIdle", t, 1]]);
            else pose([["FallToLand", Math.min(t - LAND, 0.76), 1]]);
            burst(t, LAND, x, y, 0.9);
            flash = 0.8 * (1 - lin(t, LAND, LAND + 0.12)) * (t >= LAND ? 1 : 0);
            aim(V(x + 0.9, y + 2.3, Z0 + 0.28), V(x, y, Math.max(z + 0.45, Z0 + 0.5)), shake(t, LAND, 0.09));
        }
        else if (t < LANDING)
        {
            var airborne = t >= TAKEOFF;
            var at = airborne ? leap(t).pos : V(0.62, runY(t), Z0 + 0.02);
            hero.position.copy(at);
            hero.rotation.set(Math.PI / 2, Math.atan2(0, -1), 0);
            hero.updateMatrixWorld(true);
            if (!airborne) pose([["Run", (t - RUN_T0) * 1.1, 1]]);
            else pose([["FallIdle", (t - TAKEOFF) * 0.6, 1]]);

            if (t < 3.6)
            {
                // ---- SPRINT: alongside her, a little ahead, low --------------------------------
                var bob = Math.sin((t - RUN_T0) * 2 * Math.PI / 0.335) * 0.025;
                aim(V(at.x + 2.3, at.y + 2.0, Z0 + 0.5 + bob), V(at.x - 0.2, at.y + 0.2, Z0 + 0.6));
            }
            else
            {
                // ---- LEAP: the camera sits on the road facing her (south, away from the store);
                // she comes flying at it and lands just in front
                var cam = V(0.35, 2.7, Z0 + 0.16);
                aim(cam, V(at.x, at.y, at.z + 0.55));
            }
        }
        else if (t < 12.4)
        {
            // ---- DANCE + REVEAL: in the roundabout --------------------------------------------
            hero.position.set(0, 0, Z0 + 0.02);
            hero.rotation.set(Math.PI / 2, Math.atan2(0, -1), 0);
            hero.updateMatrixWorld(true);
            var land = t - LANDING, d0 = 0.42;
            if (land < d0) pose([["FallToLand", land, 1]]);
            else if (land < d0 + 0.25) pose([["FallToLand", land, 1 - (land - d0) / 0.25], ["BreakDance", land - d0, (land - d0) / 0.25]]);
            else pose([["BreakDance", land - d0, 1]]);
            burst(t, LANDING, 0, 0, 1.3);
            flash = 0.7 * (1 - lin(t, LANDING, LANDING + 0.12)) * (t >= LANDING ? 1 : 0);
            var jolt = shake(t, LANDING, 0.07);
            var focus = V(0, 0, Z0 + 0.45);

            if (t < 6.9)
            {
                // from where the leap camera was, swing round her (staying on the north side,
                // so the store stays behind the camera)
                var c = lin(t, LANDING, 6.9), ang = mix(1.45, 2.25, ease(c)), rad = mix(2.7, 3.0, c);
                aim(V(Math.cos(ang) * rad, Math.sin(ang) * rad, Z0 + mix(0.16, 0.7, c)), focus, jolt);
            }
            else if (t < 8.1)
            {
                // cut: close and high, spinning the other way
                var c2 = lin(t, 6.9, 8.1), ang2 = mix(1.9, 0.9, c2);
                aim(V(Math.cos(ang2) * 1.7, Math.sin(ang2) * 1.7, Z0 + 1.9), V(0, 0, Z0 + 0.25));
                flash = Math.max(flash, 0.35 * (1 - lin(t, 6.9, 6.97)));
            }
            else if (t < 9.4)
            {
                // cut: right on the ground, wide
                var c3 = lin(t, 8.1, 9.4), ang3 = mix(3.6, 3.95, c3);
                aim(V(Math.cos(ang3) * 4.3, Math.sin(ang3) * 4.3, Z0 + 0.14), V(0, 0, Z0 + 0.55));
                flash = Math.max(flash, 0.35 * (1 - lin(t, 8.1, 8.17)));
            }
            else
            {
                // crane straight up: she has been dancing on the logo all along
                var lt = lin(t, 9.4, 11.9), d = ease(lt), rise = easeOut(lt), ang4 = 3.95, rad4 = mix(4.3, 0.02, d);
                camera.position.set(Math.cos(ang4) * rad4, Math.sin(ang4) * rad4, Z0 + mix(0.14, 13.5, rise));
                camera.up.set(0, 0, 1).lerp(V(0, 1, 0), d).normalize();
                camera.lookAt(V(0, 0, Z0 + mix(0.55, 0, d)));
                paintLogo(easeOut(lin(t, 10.9, 12.1)), 1);
            }
        }
        else
        {
            // ---- LOGO ---------------------------------------------------------------------
            renderer.domElement.style.visibility = "hidden";
            ctx.fillStyle = WASHED; ctx.fillRect(0, 0, W, H);
            var e = lin(t, 12.5, 13.3), size = W * 0.6 * mix(0.94, 1, easeOut(e));
            if (City.logo_image && e > 0)
            {
                var tmp = document.createElement("canvas"); tmp.width = tmp.height = Math.round(size);
                City.drawLogo(tmp.getContext("2d"), City.logo_image, 0, 0, size, CREAM);
                var visible = size * easeOut(e);
                ctx.drawImage(tmp, 0, size - visible, size, visible, (W - size) / 2, H * 0.46 - size / 2 + (size - visible), size, visible);
            }
            return;
        }

        camera.updateMatrixWorld(true);
        Terrain.update();
        renderer.render(scene, camera);
        if (flash > 0) { ctx.fillStyle = "rgba(255,250,240," + flash + ")"; ctx.fillRect(0, 0, W, H); }
        finish(t, frameNo);
    };

    window.AD = { frame : frame, DURATION : DURATION, ready : true };
});
})();
