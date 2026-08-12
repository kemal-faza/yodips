  <script lang="ts" setup>
import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import type { Component } from 'vue';
import { useEventListener, useTimeout } from '@vueuse/core';
import { Motion, useSpring } from 'motion-v';
import DefaultCursor from './DefaultCursor.vue';

type SpringValue = ReturnType<typeof useSpring>;

interface Position {
  x: number;
  y: number;
}

interface SmoothCursorProps {
  cursor?: Component;
  springConfig?: {
    damping: number;
    stiffness: number;
    mass: number;
    restDelta: number;
  };
}

const props = withDefaults(defineProps<SmoothCursorProps>(), {
  cursor: () => DefaultCursor,
  springConfig: () => ({ damping: 45, stiffness: 400, mass: 1, restDelta: 0.001 }),
});

const active = ref(false);

// Springs created lazily in onMounted (only when `pointer: fine`), so on
// touch / jsdom (`matches:false`) NOTHING from motion-v is initialized.
const cursorX = shallowRef<SpringValue | null>(null);
const cursorY = shallowRef<SpringValue | null>(null);
const rotation = shallowRef<SpringValue | null>(null);
const scale = shallowRef<SpringValue | null>(null);

const isMoving = ref(false);
const lastMousePos = ref<Position>({ x: 0, y: 0 });
const velocity = ref<Position>({ x: 0, y: 0 });
const lastUpdateTime = ref(Date.now());
const previousAngle = ref(0);
const accumulatedRotation = ref(0);

function updateVelocity(currentPos: Position) {
  const currentTime = Date.now();
  const deltaTime = currentTime - lastUpdateTime.value;
  if (deltaTime > 0) {
    velocity.value = {
      x: (currentPos.x - lastMousePos.value.x) / deltaTime,
      y: (currentPos.y - lastMousePos.value.y) / deltaTime,
    };
  }
  lastUpdateTime.value = currentTime;
  lastMousePos.value = currentPos;
}

function smoothMouseMove(e: MouseEvent) {
  const currentPos = { x: e.clientX, y: e.clientY };
  updateVelocity(currentPos);
  const speed = Math.sqrt(velocity.value.x ** 2 + velocity.value.y ** 2);

  cursorX.value?.set(currentPos.x);
  cursorY.value?.set(currentPos.y);

  if (speed > 0.1) {
    const currentAngle = Math.atan2(velocity.value.y, velocity.value.x) * (180 / Math.PI) + 90;
    let angleDiff = currentAngle - previousAngle.value;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;
    accumulatedRotation.value += angleDiff;
    rotation.value?.set(accumulatedRotation.value);
    previousAngle.value = currentAngle;

    scale.value?.set(0.95);
    isMoving.value = true;
    useTimeout(150, {
      callback: () => {
        scale.value?.set(1);
        isMoving.value = false;
      },
    });
  }
}

let rafId = 0;
function throttledMouseMove(e: MouseEvent) {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    smoothMouseMove(e);
    rafId = 0;
  });
}

let cleanup: (() => void) | null = null;

onMounted(() => {
  const fine = window.matchMedia?.('(pointer: fine)')?.matches;
  if (!fine) return; // total short-circuit: no springs, no Motion render, no cursor:none
  active.value = true;
  cursorX.value = useSpring(0, props.springConfig);
  cursorY.value = useSpring(0, props.springConfig);
  rotation.value = useSpring(0, { ...props.springConfig, damping: 60, stiffness: 300 });
  scale.value = useSpring(1, { ...props.springConfig, stiffness: 500, damping: 35 });
  document.body.style.cursor = 'none';
  cleanup = useEventListener(window, 'mousemove', throttledMouseMove);
});

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId);
  if (cleanup) cleanup();
  if (active.value) document.body.style.cursor = 'default';
});
</script>
