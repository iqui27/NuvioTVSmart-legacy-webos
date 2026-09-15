import assert from "node:assert/strict";
import test from "node:test";

import { redefinirFatorDoPlanoParaTeste, tmdbImageAtSize } from "./tmdbImageSize.js";

const POSTER = "https://image.tmdb.org/t/p/w500/abc.jpg";
const BACKDROP = "https://image.tmdb.org/t/p/original/def.jpg";

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

test("sem __NUVIO_UI_PLANE__ (build webOS 4) nada muda", () => {
  comPlano(undefined, () => {
    assert.equal(tmdbImageAtSize(POSTER, "w342"), "https://image.tmdb.org/t/p/w342/abc.jpg");
    assert.equal(tmdbImageAtSize(BACKDROP, "w1280"), "https://image.tmdb.org/t/p/w1280/def.jpg");
  });
});

test("plano de 1920 (sem folha 720, sem transform) nao aplica degrau", () => {
  comPlano({ vp: 1920, tela: 1920, sufixo: "", escala: 1, fatorCss: 1 }, () => {
    assert.equal(tmdbImageAtSize(POSTER, "w342"), "https://image.tmdb.org/t/p/w342/abc.jpg");
  });
});

test("folha de 720 desce um degrau em cada tamanho usado pelas telas", () => {
  comPlano({ vp: 1280, tela: 1280, sufixo: "-720", escala: 1, fatorCss: 2 / 3 }, () => {
    assert.equal(tmdbImageAtSize(BACKDROP, "w1280"), "https://image.tmdb.org/t/p/w780/def.jpg");
    assert.equal(tmdbImageAtSize(BACKDROP, "w780"), "https://image.tmdb.org/t/p/w500/def.jpg");
    assert.equal(tmdbImageAtSize(POSTER, "w500"), "https://image.tmdb.org/t/p/w342/abc.jpg");
  });
});

test("transform de ultimo recurso conta igual a folha de 720", () => {
  comPlano({ vp: 1920, tela: 1280, sufixo: "", escala: 1280 / 1920, fatorCss: 1 }, () => {
    assert.equal(tmdbImageAtSize(POSTER, "w500"), "https://image.tmdb.org/t/p/w342/abc.jpg");
  });
});

test("w342 NAO desce: o degrau do poster de catalogo foi revertido por borrar", () => {
  comPlano({ vp: 1280, tela: 1280, sufixo: "-720", escala: 1, fatorCss: 2 / 3 }, () => {
    assert.equal(tmdbImageAtSize(POSTER, "w342"), "https://image.tmdb.org/t/p/w342/abc.jpg");
  });
});

test("tamanho fora da escada passa intacto", () => {
  comPlano({ vp: 1280, tela: 1280, sufixo: "-720", escala: 1, fatorCss: 2 / 3 }, () => {
    assert.equal(tmdbImageAtSize(POSTER, "w185"), "https://image.tmdb.org/t/p/w185/abc.jpg");
  });
});

test("o degrau nao faz a regra de nao-aumentar subir um tamanho", () => {
  // O addon mandou w185; pedir w500 num plano de 720 vira w342, maior que o que
  // veio -- e a guarda de nao-aumentar mantem a URL original.
  comPlano({ vp: 1280, tela: 1280, sufixo: "-720", escala: 1, fatorCss: 2 / 3 }, () => {
    const pequena = "https://image.tmdb.org/t/p/w185/abc.jpg";
    assert.equal(tmdbImageAtSize(pequena, "w500"), pequena);
  });
});

test("URL que nao e do TMDB volta intacta mesmo com degrau ativo", () => {
  comPlano({ vp: 1280, tela: 1280, sufixo: "-720", escala: 1, fatorCss: 2 / 3 }, () => {
    const outra = "https://images.metahub.space/poster/medium/tt0111161/img";
    assert.equal(tmdbImageAtSize(outra, "w342"), outra);
  });
});
