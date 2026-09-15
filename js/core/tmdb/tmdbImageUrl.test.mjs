import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTmdbBackdropUrl, tmdbArteParaTelaEstatica } from "./tmdbImageUrl.js";
import { redefinirFatorDoPlanoParaTeste } from "../util/tmdbImageSize.js";

const PLANO_720 = { vp: 1280, tela: 1280, sufixo: "-720", escala: 1, fatorCss: 2 / 3 };

function comPlano(plano, corpo) {
  const anterior = globalThis.__NUVIO_UI_PLANE__;
  globalThis.__NUVIO_UI_PLANE__ = plano;
  redefinirFatorDoPlanoParaTeste();
  try {
    corpo();
  } finally {
    globalThis.__NUVIO_UI_PLANE__ = anterior;
    redefinirFatorDoPlanoParaTeste();
  }
}

test("plano de 1920: backdrop continua indo para w1280", () => {
  comPlano(undefined, () => {
    assert.equal(
      normalizeTmdbBackdropUrl("https://image.tmdb.org/t/p/original/a.jpg"),
      "https://image.tmdb.org/t/p/w1280/a.jpg"
    );
    assert.equal(
      normalizeTmdbBackdropUrl("https://image.tmdb.org/t/p/w780/a.jpg"),
      "https://image.tmdb.org/t/p/w1280/a.jpg"
    );
  });
});

test("plano de 720: backdrop alveja w780 e nao infla o que ja esta certo", () => {
  comPlano(PLANO_720, () => {
    assert.equal(
      normalizeTmdbBackdropUrl("https://image.tmdb.org/t/p/original/a.jpg"),
      "https://image.tmdb.org/t/p/w780/a.jpg"
    );
    assert.equal(
      normalizeTmdbBackdropUrl("https://image.tmdb.org/t/p/w780/a.jpg"),
      "https://image.tmdb.org/t/p/w780/a.jpg"
    );
    assert.equal(
      normalizeTmdbBackdropUrl("https://image.tmdb.org/t/p/w1280/a.jpg"),
      "https://image.tmdb.org/t/p/w1280/a.jpg"
    );
  });
});

test("plano de 1920: tela estatica continua subindo para original", () => {
  comPlano(undefined, () => {
    assert.equal(
      tmdbArteParaTelaEstatica("https://image.tmdb.org/t/p/w1280/a.jpg"),
      "https://image.tmdb.org/t/p/original/a.jpg"
    );
  });
});

test("plano de 720: tela estatica para em w1280, nao em original", () => {
  comPlano(PLANO_720, () => {
    assert.equal(
      tmdbArteParaTelaEstatica("https://image.tmdb.org/t/p/original/a.jpg"),
      "https://image.tmdb.org/t/p/w1280/a.jpg"
    );
  });
});

test("tamanho pedido explicitamente e respeitado nos dois planos", () => {
  comPlano(PLANO_720, () => {
    assert.equal(
      tmdbArteParaTelaEstatica("https://image.tmdb.org/t/p/original/a.jpg", "w500"),
      "https://image.tmdb.org/t/p/w500/a.jpg"
    );
  });
});

test("URL fora do TMDB volta intacta", () => {
  comPlano(PLANO_720, () => {
    const outra = "https://images.metahub.space/background/medium/tt0111161/img";
    assert.equal(normalizeTmdbBackdropUrl(outra), outra);
    assert.equal(tmdbArteParaTelaEstatica(outra), outra);
  });
});
