import {
  describeTraditionTreeTemplate,
  TRADITION_TREE_TEMPLATES,
  type TraditionTreeNode,
} from "@/src/tradition-tree-templates";

import styles from "./TraditionTreeTemplates.module.css";

const NODE_RADIUS = 17;
const COLUMN_GAP = 60;
const ROW_GAP = 58;
const PADDING = 29;
const VIEWBOX_WIDTH = PADDING * 2 + COLUMN_GAP * 2;
const VIEWBOX_HEIGHT = PADDING * 2 + ROW_GAP * 2;

const point = (node: TraditionTreeNode) => ({
  x: PADDING + node.column * COLUMN_GAP,
  y: PADDING + node.row * ROW_GAP,
});

const line = (from: TraditionTreeNode, to: TraditionTreeNode) => {
  const start = point(from);
  const finish = point(to);
  const dx = finish.x - start.x;
  const dy = finish.y - start.y;
  const distance = Math.hypot(dx, dy);
  const unitX = dx / distance;
  const unitY = dy / distance;

  return {
    x1: start.x + unitX * NODE_RADIUS,
    y1: start.y + unitY * NODE_RADIUS,
    x2: finish.x - unitX * (NODE_RADIUS + 5),
    y2: finish.y - unitY * (NODE_RADIUS + 5),
  };
};

export function TraditionTreeTemplates() {
  return (
    <div className={styles.templateGallery}>
      {TRADITION_TREE_TEMPLATES.map((template) => {
        const nodes = new Map(
          template.nodes.map((templateNode) => [templateNode.slot, templateNode])
        );
        const rows = Math.max(...template.nodes.map((templateNode) => templateNode.row)) + 1;
        const rowOffset = rows === 2 ? ROW_GAP / 2 : 0;
        const titleId = `${template.name}-title`;
        const descriptionId = `${template.name}-description`;
        const markerId = `${template.name}-arrow`;
        const description = describeTraditionTreeTemplate(template);

        return (
          <figure key={template.name} className={styles.templateCard}>
            <svg
              viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
              role="img"
              aria-labelledby={`${titleId} ${descriptionId}`}
            >
              <title id={titleId}>{template.name}</title>
              <desc id={descriptionId}>{description}.</desc>
              <defs>
                <marker
                  id={markerId}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" className={styles.arrowhead} />
                </marker>
              </defs>
              <g aria-hidden="true" transform={`translate(0 ${rowOffset})`}>
                {template.edges.map((templateEdge) => {
                  const from = nodes.get(templateEdge.from)!;
                  const to = nodes.get(templateEdge.to)!;
                  const coordinates = line(from, to);
                  return (
                    <line
                      key={`${templateEdge.from}-${templateEdge.to}`}
                      {...coordinates}
                      className={styles.edge}
                      markerEnd={`url(#${markerId})`}
                    />
                  );
                })}
                {template.nodes.map((templateNode) => {
                  const coordinates = point(templateNode);
                  return (
                    <g
                      key={templateNode.slot}
                      transform={`translate(${coordinates.x} ${coordinates.y})`}
                    >
                      <path
                        d="M 0 -17 L 15 -8.5 L 15 8.5 L 0 17 L -15 8.5 L -15 -8.5 z"
                        className={styles.node}
                      />
                      <text x="0" y="1" className={styles.nodeLabel}>
                        {templateNode.slot}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            <figcaption>
              <code>{template.name}</code>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
