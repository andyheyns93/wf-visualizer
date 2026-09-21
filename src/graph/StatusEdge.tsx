import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { Fragment } from 'react';
import { DEFAULT_STATUS_COLOR, colorForStatus } from './palette';

export interface StatusEdgeData extends Record<string, unknown> {
  statuses?: string[];
}

export function StatusEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
  } = props;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  const statuses = (props.data as StatusEdgeData | undefined)?.statuses ?? [];
  const colors = statuses.map(colorForStatus);
  const multi = colors.length > 1;
  const gradientId = `edge-grad-${id}`;
  const stroke = multi ? `url(#${gradientId})` : colors[0] ?? DEFAULT_STATUS_COLOR;

  // Dotted for non-success paths (TimedOut / Skipped / Failed); solid for Succeeded and
  // the implicit trigger→root connectors.
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const dotted = statuses.some((s) => normalize(s) !== 'succeeded');
  const strokeDasharray = dotted ? '2 3' : undefined;

  return (
    <>
      {multi && (
        <defs>
          {/* Hard color stops → a segmented, multi-color line following the edge. */}
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
          >
            {colors.map((c, i) => (
              <Fragment key={i}>
                <stop offset={`${(i / colors.length) * 100}%`} stopColor={c} />
                <stop offset={`${((i + 1) / colors.length) * 100}%`} stopColor={c} />
              </Fragment>
            ))}
          </linearGradient>
        </defs>
      )}

      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke, strokeWidth: 1.8, strokeDasharray }} />

      {statuses.length > 0 && (
        <EdgeLabelRenderer>
          <div
            className="wf-edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {statuses.map((s, i) => (
              <span
                key={i}
                className="wf-edge-chip"
                style={{ color: colors[i], borderColor: colors[i] }}
              >
                {s.toUpperCase()}
              </span>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
