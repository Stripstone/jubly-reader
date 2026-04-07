// ===================================
// FIRE EMBERS CANVAS ANIMATION
// ===================================
(function() {
  var canvas = document.getElementById('fireCanvas');
  var ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;

  function noop() {}
  if (!canvas || !ctx) {
    window.rcEmbers = {
      setColors: noop,
      refreshBounds: noop,
      restart: noop,
      syncVisibility: noop
    };
    return;
  }

  var ww = 1;
  var wh = 1;
  var particles = [];
  var emberColorArray = ['#FF2200', '#FF6600', '#FFA500'];
  var animationFrame = 0;

  function readConfig() {
    var rootStyles = getComputedStyle(document.documentElement);
    return {
      quantity: parseInt(rootStyles.getPropertyValue('--ember-quantity'), 10) || 45,
      sizeMin: parseFloat(rootStyles.getPropertyValue('--ember-size-min')) || 1,
      sizeMax: parseFloat(rootStyles.getPropertyValue('--ember-size-max')) || 3,
      speedMin: parseFloat(rootStyles.getPropertyValue('--ember-speed-min')) || 0.3,
      speedMax: parseFloat(rootStyles.getPropertyValue('--ember-speed-max')) || 0.5,
      lifeMin: parseFloat(rootStyles.getPropertyValue('--ember-life-min')) || 0.5,
      lifeMax: parseFloat(rootStyles.getPropertyValue('--ember-life-max')) || 1.0,
      fadeThreshold: parseInt(rootStyles.getPropertyValue('--ember-fade-threshold'), 10) || 25
    };
  }

  function isVisibleContext() {
    var body = document.body;
    return !!(body && body.classList.contains('theme-explorer') && body.classList.contains('reading-active') && !body.classList.contains('explorer-embers-off'));
  }

  function between(min, max) {
    return Math.random() * (max - min) + min;
  }

  function getViewportSpawnBand() {
    var rect = canvas.getBoundingClientRect();
    var viewportBottomInCanvas = Math.max(0, Math.min(wh, window.innerHeight - rect.top));
    var bandStart = Math.max(0, viewportBottomInCanvas + 8);
    var bandEnd = Math.min(wh + 36, viewportBottomInCanvas + 56);
    if (bandEnd <= bandStart) {
      bandStart = Math.max(0, wh - 24);
      bandEnd = wh + 24;
    }
    return { start: bandStart, end: bandEnd };
  }

  function refreshCanvasBounds(resetParticles) {
    var parent = canvas.parentElement || document.querySelector('#reading-mode .reading-content');
    var rect = parent ? parent.getBoundingClientRect() : null;
    var parentScrollWidth = parent ? parent.scrollWidth : 0;
    var parentScrollHeight = parent ? parent.scrollHeight : 0;
    var nextW = Math.max(1, Math.round(Math.max((rect && rect.width) || 0, parentScrollWidth || 0, canvas.clientWidth || 0, window.innerWidth || 0)));
    var nextH = Math.max(1, Math.round(Math.max((rect && rect.height) || 0, parentScrollHeight || 0, canvas.clientHeight || 0, window.innerHeight || 0)));
    ww = nextW;
    wh = nextH;
    canvas.width = ww;
    canvas.height = wh;
    canvas.style.width = ww + 'px';
    canvas.style.height = wh + 'px';
    if (resetParticles) reseedParticles();
  }

  function resetParticle(particle) {
    var config = readConfig();
    var spawnBand = getViewportSpawnBand();
    particle.x = between(ww * 0.1, ww * 0.9);
    particle.y = between(spawnBand.start, spawnBand.end);
    particle.size = between(config.sizeMin, config.sizeMax);
    particle.vx = Math.random() * 1 - 0.5;
    particle.vy = -between(config.speedMin, config.speedMax);
    particle.g = -0.001 * Math.random() * 10;
    particle.life = between(wh * config.lifeMin, wh * config.lifeMax);
    particle.color = emberColorArray[Math.floor(Math.random() * emberColorArray.length)] || '#FF6600';
    return particle;
  }

  function reseedParticles() {
    var config = readConfig();
    particles = [];
    for (var i = 0; i < config.quantity; i++) {
      particles.push(resetParticle({}));
    }
  }

  function tick() {
    animationFrame = 0;

    if (!isVisibleContext()) {
      ctx.clearRect(0, 0, ww, wh);
      return;
    }

    if (!particles.length) reseedParticles();
    ctx.clearRect(0, 0, ww, wh);

    var config = readConfig();
    for (var i = 0; i < particles.length; i++) {
      var particle = particles[i];

      ctx.beginPath();
      ctx.fillStyle = particle.color;
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2, false);
      ctx.fill();

      particle.x += particle.vx;
      particle.y += particle.vy += particle.g;
      particle.life -= 1;

      if (particle.life < config.fadeThreshold) {
        particle.color = 'rgba(25, 25, 25, 0.3)';
      }
      if (particle.life < 1 || particle.y < -12) {
        resetParticle(particle);
      }
    }

    animationFrame = window.requestAnimationFrame(tick);
  }

  function start() {
    refreshCanvasBounds(true);
    if (!animationFrame) animationFrame = window.requestAnimationFrame(tick);
  }

  function stop() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    ctx.clearRect(0, 0, ww, wh);
  }

  function restart() {
    stop();
    if (isVisibleContext()) start();
  }

  function syncVisibility() {
    if (isVisibleContext()) start();
    else stop();
  }

  refreshCanvasBounds(true);
  syncVisibility();

  window.addEventListener('resize', function() {
    refreshCanvasBounds(true);
    if (isVisibleContext() && !animationFrame) animationFrame = window.requestAnimationFrame(tick);
  });

  window.addEventListener('scroll', function() {
    if (!isVisibleContext()) return;
    if (!animationFrame) animationFrame = window.requestAnimationFrame(tick);
  }, { passive: true });

  if (window.ResizeObserver && canvas.parentElement) {
    try {
      var resizeObserver = new ResizeObserver(function() {
        refreshCanvasBounds(true);
        if (isVisibleContext() && !animationFrame) animationFrame = window.requestAnimationFrame(tick);
      });
      resizeObserver.observe(canvas.parentElement);
    } catch (_) {}
  }

  if (window.MutationObserver && document.body) {
    try {
      var bodyObserver = new MutationObserver(function() {
        syncVisibility();
      });
      bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (_) {}
  }

  window.rcEmbers = {
    setColors: function(colorArray) {
      if (Array.isArray(colorArray) && colorArray.length) {
        emberColorArray = colorArray.slice();
        reseedParticles();
        if (!animationFrame && isVisibleContext()) animationFrame = window.requestAnimationFrame(tick);
      }
    },
    refreshBounds: function(resetParticles) {
      refreshCanvasBounds(!!resetParticles);
      if (resetParticles) reseedParticles();
      if (!animationFrame && isVisibleContext()) animationFrame = window.requestAnimationFrame(tick);
    },
    restart: restart,
    syncVisibility: syncVisibility
  };
})();
