<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { cn } from '@/lib/utils';

interface Props {
  texts: string[];
  morphTime?: number;
  coolDownTime?: number;
  class?: string;
}
const props = withDefaults(defineProps<Props>(), {
  morphTime: 1.5,
  coolDownTime: 0.5,
});

const textIndex = ref(0);
const morph = ref(0);
const coolDown = ref(0);
const time = ref(Date.now());
const text1Ref = ref<HTMLElement | null>(null);
const text2Ref = ref<HTMLElement | null>(null);

function setStyles(fraction: number) {
  if (!text1Ref.value || !text2Ref.value) return;
  text2Ref.value.style.filter = `blur(${Math.min(8 / Math.max(fraction, 1e-3) - 8, 100)}px)`;
  text2Ref.value.style.opacity = `${fraction ** 0.4 * 100}%`;
  const invertedFraction = 1 - fraction;
  text1Ref.value.style.filter = `blur(${Math.min(8 / Math.max(invertedFraction, 1e-3) - 8, 100)}px)`;
  text1Ref.value.style.opacity = `${invertedFraction ** 0.4 * 100}%`;
  text1Ref.value.textContent = props.texts[textIndex.value % props.texts.length] ?? '';
  text2Ref.value.textContent = props.texts[(textIndex.value + 1) % props.texts.length] ?? '';
}

function doMorph() {
  morph.value -= coolDown.value;
  coolDown.value = 0;
  let fraction = morph.value / props.morphTime;
  if (fraction > 1) {
    coolDown.value = props.coolDownTime;
    fraction = 1;
  }
  setStyles(fraction);
  if (fraction === 1) textIndex.value++;
}

function doCoolDown() {
  morph.value = 0;
  if (text1Ref.value && text2Ref.value) {
    text2Ref.value.style.filter = 'none';
    text2Ref.value.style.opacity = '100%';
    text1Ref.value.style.filter = 'none';
    text1Ref.value.style.opacity = '0%';
    // The invisible span must not hold width: blank it so the inline-grid
    // settles to the current visible word and the following text reflows.
    text1Ref.value.textContent = '';
  }
}

let rafId = 0;
function animate() {
  rafId = requestAnimationFrame(animate);
  const now = Date.now();
  const dt = (now - time.value) / 1000;
  time.value = now;
  coolDown.value -= dt;
  if (coolDown.value <= 0) doMorph();
  else doCoolDown();
}

onMounted(() => {
  time.value = Date.now();
  animate();
});
onUnmounted(() => cancelAnimationFrame(rafId));
</script>

<template>
  <div
    :class="cn('relative inline-grid', props.class)"
  >
    <!-- Both spans occupy the SAME grid cell ([grid-area:1/1]), so they overlap
         and morph into each other while the inline-grid tracks the WIDEST of the
         two words every frame. The following sibling text (e.g. ", {name}!")
         flows after the grid and reflows in sync with the morphing word — no
         lag, no collapse. No fixed box/font-size: inherits the parent h1 size. -->
    <span ref="text1Ref" class="[grid-area:1/1] inline-block" aria-hidden="true" />
    <span ref="text2Ref" class="[grid-area:1/1] inline-block" aria-hidden="true" />
  </div>
</template>