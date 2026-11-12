define(["three", "renderer", "camera", "container", "scene", "physics", "world",
        "player", "debug", "multiplayer", "eventQ", "time", "city"],
        (THREE, renderer, camera, container, scene, Physics, World, Player, Debug,
         Multiplayer, EventQ, Time, City) => {

    var game = {
        init: () => {
            THREE.Cache.enabled = true;
            Physics.init();
            Debug.init();
            // the city is solid before the player arrives, and the player starts on its main street
            City.init();
            Player.init_pos.copy(City.spawn);
            Player.onPlatform = () => City.isGrounded(Player.threeObj.position);
            Player.init();
            World.init(Player);
        },

        update: () => {
            requestAnimationFrame(game.update);

            Debug.updateStart();

            var delta = Time.clock.getDelta();

            EventQ.update();
            Physics.update(delta);
            Player.update(delta);
            World.update(delta, Player);
            City.update(delta);

            renderer.render(scene, camera);

            Debug.updateEnd();
        },


    };
    return game;
});
