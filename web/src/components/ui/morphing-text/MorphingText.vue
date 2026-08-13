<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { cn } from '@/lib/utils';
import { createIntervalShuffler } from '@/utils/morphSequence';

interface Props {
  texts: string[];
  morphTime?: number;
  coolDownTime?: number;
  randomize?: boolean;
  class?: string;
}
const props = withDefaults(defineProps<Props>(), {
  morphTime: 1.5,
  coolDownTime: 0.5,
  randomize: true,
});

const textIndex = ref(0);
const nextIndex = ref(1);
const morph = ref(0);
const coolDown = ref(0);
const time = ref(Date.now());
const containerRef = ref<HTMLElement | null>(null);
const sizerRef = ref<HTMLElement | null>(null);
const text1Ref = ref<HTMLElement | null>(null);
const text2Ref = ref<HTMLElement | null>(null);

let nextIndexFn: ((current: number) => number) | null = null;

function setNextIndex() {
  if (!nextIndexFn) {
    nextIndexFn = createIntervalShuffler(props.texts.length, Math.random, props.randomize);
  }
  nextIndex.value = nextIndexFn(textIndex.value);
}

function setStyles(fraction: number) {
  if (!text1Ref.value || !text2Ref.value) return;
  text2Ref.value.style.filter = `blur(${Math.min(8 / Math.max(fraction, 1e-3) - 8, 100)}px)`;
  text2Ref.value.style.opacity = `${fraction ** 0.4 * 100}%`;
  const invertedFraction = 1 - fraction;
  text1Ref.value.style.filter = `blur(${Math.min(8 / Math.max(invertedFraction, 1e-3) - 8, 100)}px)`;
  text1Ref.value.style.opacity = `${invertedFraction ** 0.4 * 100}%`;

  const word1 = props.texts[textIndex.value % props.texts.length] ?? '';
  const word2 = props.texts[nextIndex.value % props.texts.length] ?? '';
  text1Ref.value.textContent = word1;
  text2Ref.value.textContent = word2;

  if (containerRef.value) {
    const w1 = text1Ref.value.offsetWidth || text1Ref.value.scrollWidth;
    const w2 = text2Ref.value.offsetWidth || text2Ref.value.scrollWidth;
    if (w1 > 0 || w2 > 0) {
      const ease = 1 - Math.pow(1 - fraction, 3);
      const currentWidth = w1 + (w2 - w1) * ease;
      containerRef.value.style.width = `${currentWidth}px`;
    }
  }
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
  if (fraction === 1) {
    textIndex.value = nextIndex.value;
    setNextIndex();
  }
}

function doCoolDown() {
  morph.value = 0;
  const currentWord = props.texts[textIndex.value % props.texts.length] ?? '';
  if (sizerRef.value) {
    sizerRef.value.textContent = currentWord;
  }
  if (containerRef.value) {
    containerRef.value.style.width = '';
  }
  if (text1Ref.value && text2Ref.value) {
    text2Ref.value.style.filter = 'none';
    text2Ref.value.style.opacity = '100%';
    text2Ref.value.textContent = currentWord;
    text1Ref.value.style.filter = 'none';
    text1Ref.value.style.opacity = '0%';
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
  setNextIndex();
  doCoolDown();
  animate();
});
onUnmounted(() => cancelAnimationFrame(rafId));
</script>

<template>
  <div
    ref="containerRef"
    :class="cn('relative inline-block align-baseline', props.class)"
  >
    <!-- Hidden SVG filter for the gooey threshold effect -->
    <svg class="absolute h-0 w-0 pointer-events-none" aria-hidden="true">
      <defs>
        <filter id="threshold">
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 255 -140"
          />
        </filter>
      </defs>
    </svg>

    <!-- In-flow invisible span drives baseline height & static/cooldown width -->
    <span
      ref="sizerRef"
      class="invisible inline-block whitespace-nowrap"
      aria-hidden="true"
    />

    <!-- Overlay container with SVG gooey threshold filter applied -->
    <span class="absolute left-0 top-0 whitespace-nowrap inline-block [filter:url(#threshold)] pointer-events-none">
      <span
        ref="text1Ref"
        class="absolute left-0 top-0 whitespace-nowrap inline-block"
        aria-hidden="true"
      />
      <span
        ref="text2Ref"
        class="absolute left-0 top-0 whitespace-nowrap inline-block"
        aria-hidden="true"
      />
    </span>
  </div>
</template>