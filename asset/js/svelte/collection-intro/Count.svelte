<script>
	// A number that counts up from zero each time its chapter plays, and
	// otherwise shows its real value: before the first play, after every
	// play, under reduced motion and in print. The counting text is hidden
	// from assistive technology, which reads the final value beside it, so a
	// screen reader never announces a figure on its way up.
	import { onDestroy } from 'svelte';

	let { value, run = 0, reduced = false, format, duration = 1200 } = $props();

	let shown = $state(null);
	let frame = 0;

	const ease = (t) => 1 - Math.pow(1 - t, 3);

	$effect(() => {
		const target = value;
		if (!run || reduced || typeof window.requestAnimationFrame !== 'function') {
			shown = null;
			return;
		}
		const start = performance.now();
		const step = (now) => {
			const t = Math.min(1, (now - start) / duration);
			shown = t < 1 ? Math.round(target * ease(t)) : null;
			if (t < 1) frame = window.requestAnimationFrame(step);
		};
		shown = 0;
		frame = window.requestAnimationFrame(step);
		return () => window.cancelAnimationFrame(frame);
	});

	onDestroy(() => window.cancelAnimationFrame(frame));
</script>

<span class="iwac-vis-intro__count" aria-hidden="true">{format(shown === null ? value : shown)}</span><span
	class="iwac-vis-intro__sr">{format(value)}</span
>
