"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import styles from "./SpotlightTour.module.css";

export type SpotlightTourStep = {
  id?: string;
  selector: string;
  title: string;
  body: ReactNode;
  spotlightPadding?: number;
};

export type SpotlightTourCloseReason = "close" | "escape" | "skip";

export type SpotlightTourLabels = {
  back: string;
  next: string;
  complete: string;
  skip: string;
  close: string;
  step: (current: number, total: number) => string;
};

export type SpotlightTourProps = {
  open: boolean;
  steps: readonly SpotlightTourStep[];
  activeStep?: number;
  defaultActiveStep?: number;
  onActiveStepChange?: (index: number, step: SpotlightTourStep) => void;
  onClose: (reason: SpotlightTourCloseReason) => void;
  onComplete: (step: SpotlightTourStep, index: number) => void;
  labels?: Partial<SpotlightTourLabels>;
  className?: string;
  /** Stable trigger to return to when the launching menu item unmounts. */
  returnFocusSelector?: string;
};

type TargetGeometry = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};

type DialogSize = {
  width: number;
  height: number;
};

const VIEWPORT_MARGIN = 16;
const TARGET_GAP = 16;
const DEFAULT_DIALOG_SIZE: DialogSize = { width: 400, height: 300 };

const defaultLabels: SpotlightTourLabels = {
  back: "Tilbage",
  next: "Næste",
  complete: "Afslut",
  skip: "Spring over",
  close: "Luk rundvisning",
  step: (current, total) => `Trin ${current} af ${total}`,
};

export function SpotlightTour({
  open,
  steps,
  activeStep,
  defaultActiveStep = 0,
  onActiveStepChange,
  onClose,
  onComplete,
  labels,
  className,
  returnFocusSelector,
}: SpotlightTourProps) {
  const [internalActiveStep, setInternalActiveStep] = useState(() =>
    clampStep(defaultActiveStep, steps.length),
  );
  const [targetGeometry, setTargetGeometry] = useState<TargetGeometry | null>(null);
  const [dialogSize, setDialogSize] = useState<DialogSize>(DEFAULT_DIALOG_SIZE);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const currentIndex = clampStep(activeStep ?? internalActiveStep, steps.length);
  const currentStep = steps[currentIndex];
  const selector = currentStep?.selector ?? "";
  const copy = useMemo(
    () => ({
      back: labels?.back ?? defaultLabels.back,
      next: labels?.next ?? defaultLabels.next,
      complete: labels?.complete ?? defaultLabels.complete,
      skip: labels?.skip ?? defaultLabels.skip,
      close: labels?.close ?? defaultLabels.close,
      step: labels?.step ?? defaultLabels.step,
    }),
    [labels],
  );

  useLayoutEffect(() => {
    if (!open || steps.length === 0) {
      return;
    }

    let disposed = false;
    let animationFrame = 0;
    let observedTarget: HTMLElement | null = null;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => scheduleMeasurement());

    function findTarget() {
      if (!selector) return null;
      try {
        return document.querySelector<HTMLElement>(selector);
      } catch {
        return null;
      }
    }

    function measureTarget() {
      animationFrame = 0;
      if (disposed) return;

      const nextTarget = findTarget();
      if (nextTarget !== observedTarget) {
        resizeObserver?.disconnect();
        observedTarget = nextTarget;
        if (observedTarget) resizeObserver?.observe(observedTarget);
      }

      if (!nextTarget || nextTarget.getClientRects().length === 0) {
        setTargetGeometry((previous) => (previous === null ? previous : null));
        return;
      }

      const rect = nextTarget.getBoundingClientRect();
      const nextGeometry: TargetGeometry = {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
      };
      setTargetGeometry((previous) =>
        sameGeometry(previous, nextGeometry) ? previous : nextGeometry,
      );
    }

    function scheduleMeasurement() {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measureTarget);
    }

    const initialTarget = findTarget();
    if (initialTarget) {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      initialTarget.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
        inline: "center",
      });
    }

    measureTarget();
    scheduleMeasurement();
    window.addEventListener("resize", scheduleMeasurement);
    document.addEventListener("scroll", scheduleMeasurement, true);

    const mutationObserver = new MutationObserver(scheduleMeasurement);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasurement);
      document.removeEventListener("scroll", scheduleMeasurement, true);
    };
  }, [open, selector, steps.length]);

  useLayoutEffect(() => {
    if (!open || !dialogRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const dialog = dialogRef.current;
    const updateDialogSize = () => {
      const rect = dialog.getBoundingClientRect();
      const nextSize = { width: rect.width, height: rect.height };
      setDialogSize((previous) =>
        previous.width === nextSize.width && previous.height === nextSize.height
          ? previous
          : nextSize,
      );
    };
    const observer = new ResizeObserver(updateDialogSize);
    observer.observe(dialog);
    updateDialogSize();
    return () => observer.disconnect();
  }, [currentIndex, open, steps.length]);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    return () => {
      const previous = previouslyFocusedRef.current;
      const target = previous?.isConnected && previous !== document.body
        ? previous
        : returnFocusSelector ? document.querySelector<HTMLElement>(returnFocusSelector) : null;
      target?.focus({ preventScroll: true });
      previouslyFocusedRef.current = null;
    };
  }, [open, returnFocusSelector]);

  useEffect(() => {
    if (!open) return;
    const animationFrame = requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [currentIndex, open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose("escape");
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === dialogRef.current || active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open]);

  if (!open) return null;

  if (!currentStep) {
    return (
      <div className={joinClasses(styles.tourRoot, className)}>
        <div className={styles.fallbackScrim} aria-hidden="true" />
        <div
          ref={dialogRef}
          className={joinClasses(styles.dialog, styles.centeredDialog)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          tabIndex={-1}
        >
          <button
            className={styles.closeButton}
            type="button"
            aria-label={copy.close}
            onClick={() => onClose("close")}
          >
            <span aria-hidden="true">×</span>
          </button>
          <h2 id={titleId}>Rundvisningen er ikke tilgængelig</h2>
          <p id={bodyId}>Der er endnu ikke konfigureret nogen trin.</p>
          <div className={styles.singleAction}>
            <button className={styles.primaryButton} type="button" onClick={() => onClose("close")}>
              Luk
            </button>
          </div>
        </div>
      </div>
    );
  }

  const spotlightStyle = getSpotlightStyle(
    targetGeometry,
    currentStep.spotlightPadding ?? 8,
  );
  const dialogStyle = getDialogStyle(targetGeometry, dialogSize);
  const isLastStep = currentIndex === steps.length - 1;

  function changeStep(nextIndex: number) {
    const boundedIndex = clampStep(nextIndex, steps.length);
    const nextStep = steps[boundedIndex];
    if (!nextStep || boundedIndex === currentIndex) return;
    if (activeStep === undefined) setInternalActiveStep(boundedIndex);
    onActiveStepChange?.(boundedIndex, nextStep);
  }

  return (
    <div className={joinClasses(styles.tourRoot, className)}>
      <div className={styles.interactionShield} aria-hidden="true" />
      {targetGeometry ? (
        <div className={styles.spotlight} style={spotlightStyle} aria-hidden="true" />
      ) : (
        <div className={styles.fallbackScrim} aria-hidden="true" />
      )}

      <div
        ref={dialogRef}
        className={styles.dialog}
        style={dialogStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <button
          className={styles.closeButton}
          type="button"
          aria-label={copy.close}
          onClick={() => onClose("close")}
        >
          <span aria-hidden="true">×</span>
        </button>

        <div className={styles.progressRow}>
          <span className={styles.stepLabel} aria-live="polite">
            {copy.step(currentIndex + 1, steps.length)}
          </span>
          <div className={styles.progressDots} aria-hidden="true">
            {steps.map((step, index) => (
              <span
                className={index === currentIndex ? styles.activeDot : undefined}
                key={step.id ?? `${step.selector}-${index}`}
              />
            ))}
          </div>
        </div>

        <h2 id={titleId}>{currentStep.title}</h2>
        <div className={styles.body} id={bodyId}>{currentStep.body}</div>

        {!targetGeometry ? (
          <p className={styles.missingTarget} role="status">
            Det markerede element er ikke synligt lige nu. Du kan stadig fortsætte rundvisningen.
          </p>
        ) : null}

        <div className={styles.actions}>
          <button className={styles.skipButton} type="button" onClick={() => onClose("skip")}>
            {copy.skip}
          </button>
          <div className={styles.stepActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={currentIndex === 0}
              onClick={() => changeStep(currentIndex - 1)}
            >
              {copy.back}
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                if (isLastStep) onComplete(currentStep, currentIndex);
                else changeStep(currentIndex + 1);
              }}
            >
              {isLastStep ? copy.complete : copy.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clampStep(index: number, count: number) {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
}

function sameGeometry(previous: TargetGeometry | null, next: TargetGeometry) {
  if (!previous) return false;
  return (Object.keys(next) as Array<keyof TargetGeometry>).every(
    (key) => Math.abs(previous[key] - next[key]) < 0.5,
  );
}

function getSpotlightStyle(
  geometry: TargetGeometry | null,
  padding: number,
): CSSProperties | undefined {
  if (!geometry) return undefined;
  const safePadding = Math.max(0, padding);
  return {
    top: geometry.top - safePadding,
    left: geometry.left - safePadding,
    width: geometry.width + safePadding * 2,
    height: geometry.height + safePadding * 2,
  };
}

function getDialogStyle(
  geometry: TargetGeometry | null,
  dialogSize: DialogSize,
): CSSProperties {
  if (!geometry) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  const availableWidth = Math.max(0, geometry.viewportWidth - VIEWPORT_MARGIN * 2);
  const width = Math.min(dialogSize.width || DEFAULT_DIALOG_SIZE.width, availableWidth);
  const height = Math.min(
    dialogSize.height || DEFAULT_DIALOG_SIZE.height,
    Math.max(0, geometry.viewportHeight - VIEWPORT_MARGIN * 2),
  );
  const centeredLeft = geometry.left + geometry.width / 2 - width / 2;
  const left = clamp(
    centeredLeft,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, geometry.viewportWidth - width - VIEWPORT_MARGIN),
  );
  const roomBelow = geometry.viewportHeight - geometry.bottom - TARGET_GAP;
  const roomAbove = geometry.top - TARGET_GAP;
  const preferredTop = roomBelow >= height || roomBelow >= roomAbove
    ? geometry.bottom + TARGET_GAP
    : geometry.top - height - TARGET_GAP;
  const top = clamp(
    preferredTop,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, geometry.viewportHeight - height - VIEWPORT_MARGIN),
  );

  return { top, left };
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}
