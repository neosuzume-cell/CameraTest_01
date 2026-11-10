(function (root) {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const neutral = () => ({ brightness: 1, contrast: 1, warmth: 0 });

  function analyzeNeighborhood(sample, rect) {
    const { data, width, height } = sample;
    const right = rect.x + rect.width, bottom = rect.y + rect.height;
    const left = Math.max(0, rect.x), top = Math.max(0, rect.y);
    const endX = Math.min(width, right), endY = Math.min(height, bottom);
    if (endX <= left || endY <= top) return neutral();

    const margin = clamp(Math.round(Math.min(endX-left, endY-top)*.18), 4, 24);
    const x0 = Math.max(0, Math.floor(left-margin)), y0 = Math.max(0, Math.floor(top-margin));
    const x1 = Math.min(width, Math.ceil(endX+margin)), y1 = Math.min(height, Math.ceil(endY+margin));
    let count = 0, light = 0, lightSquared = 0, colorWeight = 0, color = 0;
    function collect(outsideOnly) {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (outsideOnly && x >= left && x < endX && y >= top && y < endY) continue;
        const i = (y*width+x)*4;
        if (data[i+3] < 240) continue;
        const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
        const yLight = .2126*r + .7152*g + .0722*b;
        count++; light += yLight; lightSquared += yLight*yLight;
        // 強い色の壁や暗部から、照明色を断定しない。
        const weight = yLight > .14 && yLight < .92
          ? Math.max(0, 1-(Math.max(r,g,b)-Math.min(r,g,b))/.30) : 0;
        colorWeight += weight;
        color += (r-b)*weight;
      }
    }
    collect(true);
    if (count < 24) { count = light = lightSquared = colorWeight = color = 0; collect(false); }
    if (!count) return neutral();
    const mean = light/count;
    const spread = Math.sqrt(Math.max(0, lightSquared/count - mean*mean));
    return {
      brightness: 1 + clamp((mean-.50)*.38, -.16, .13),
      contrast: 1 + clamp((spread-.17)*.45, -.07, .08),
      warmth: colorWeight/count >= .12 ? clamp(color/colorWeight*.28, -.045, .045) : 0
    };
  }

  function adjustPixels(pixels, correction) {
    const { brightness, contrast, warmth } = correction;
    for (let i = 0; i < pixels.length; i += 4) {
      if (!pixels[i+3]) continue;
      const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
      const saturation = (Math.max(r,g,b)-Math.min(r,g,b))/255;
      const tone = warmth*(1-saturation*.75);
      pixels[i] = ((r-128)*contrast+128)*brightness*(1+tone);
      pixels[i+1] = ((g-128)*contrast+128)*brightness;
      pixels[i+2] = ((b-128)*contrast+128)*brightness*(1-tone*.7);
      // 透過値・形状には手を加えない。
    }
  }

  // Provider contract: clean background + original sprites and output-pixel
  // rectangles in back-to-front order. Returns one adjustment per sprite.
  // An asynchronous provider can replace this without changing capture/save UI.
  function analyze(scene) {
    const { background, subjects } = scene;
    const scale = Math.min(1, 256/Math.max(background.width, background.height));
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = Math.max(1, Math.round(background.width*scale));
    sampleCanvas.height = Math.max(1, Math.round(background.height*scale));
    try {
      const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(background, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const sample = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
      const sx = sample.width/background.width, sy = sample.height/background.height;
      return subjects.map(({ rect }) => analyzeNeighborhood(sample, {
        x: rect.x*sx, y: rect.y*sy, width: rect.width*sx, height: rect.height*sy
      }));
    } finally { sampleCanvas.width = sampleCanvas.height = 1; }
  }

  function render(scene, corrections, output) {
    output.width = scene.background.width;
    output.height = scene.background.height;
    const ctx = output.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scene.background, 0, 0);
    const sprite = document.createElement('canvas');
    try {
      for (const [i, { image, rect }] of scene.subjects.entries()) {
        const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
        const w = Math.min(output.width, rect.x+rect.width)-x;
        const h = Math.min(output.height, rect.y+rect.height)-y;
        if (w <= 0 || h <= 0) continue;
        // 画面外は処理しない。巨大な配置でも作業領域は出力画像以下。
        const sx = image.naturalWidth/rect.width, sy = image.naturalHeight/rect.height;
        const workScale = Math.min(1, sx, sy, Math.sqrt(2000000/(w*h)));
        sprite.width = Math.max(1, Math.ceil(w*workScale));
        sprite.height = Math.max(1, Math.ceil(h*workScale));
        const work = sprite.getContext('2d', { willReadFrequently: true });
        work.imageSmoothingQuality = 'high';
        work.drawImage(image, (x-rect.x)*sx, (y-rect.y)*sy, w*sx, h*sy,
          0, 0, sprite.width, sprite.height);
        const pixels = work.getImageData(0, 0, sprite.width, sprite.height);
        adjustPixels(pixels.data, corrections[i]);
        work.putImageData(pixels, 0, 0);
        ctx.drawImage(sprite, x, y, w, h);
      }
    } finally { sprite.width = sprite.height = 1; }
  }

  root.ZenjiroFinish = { analyze, render, analyzeNeighborhood, adjustPixels };
})(typeof window === 'undefined' ? globalThis : window);
