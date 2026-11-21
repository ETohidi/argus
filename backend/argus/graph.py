"""The metric graph: a causal DAG over business metrics, across abstraction levels.

L1  Global and country totals (breakdown edges: sums over platform and category)
L2  Segments: country x platform x advertiser category, with causal mechanisms
L3  Users: individual accounts, scored by the taste model (only on demand)
"""
from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field

MECHANISMS = ["new_accounts", "active_users", "impressions", "starts", "completions", "revenue", "rewards", "quality"]


@dataclass
class Node:
    id: str
    label: str
    unit: str
    kind: str              # count | money | ratio
    level: str             # L1/L2 (L1 nodes are breakdown sums of L2 nodes)
    parents: list[str] = field(default_factory=list)
    edge: str = "mechanism"  # root | mechanism | formula
    mechanism: str = ""
    expr: str | None = None
    aggregation: str = "sum"  # sum | ratio
    origin: str = "core"      # core | extension
    confidence: float = 1.0
    description: str = ""
    note: str = ""

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in ("id", "label", "unit", "kind", "level", "parents", "edge", "mechanism",
                                               "expr", "aggregation", "origin", "confidence", "description", "note")}


CORE_NODES: list[Node] = [
    Node("new_accounts", "New accounts", "accounts/h", "count", "L2", [], "root",
         "Sign-ups per hour (seasonal baseline)", description="Accounts created per hour."),
    Node("active_users", "Active users", "users/h", "count", "L2", ["new_accounts"], "mechanism",
         "Returning users follow the daily rhythm; new accounts stay ~3 h on day one",
         description="Users active on the offer wall."),
    Node("impressions", "Offer impressions", "views/h", "count", "L2", ["active_users"], "mechanism",
         "Feed allocation: impressions per active user per category", description="Offers shown on the wall."),
    Node("starts", "Offer starts", "starts/h", "count", "L2", ["impressions"], "mechanism",
         "Start rate: how attractive the offer is to these users", description="Users who start an offer."),
    Node("completions", "Completions", "completions/h", "count", "L2", ["starts"], "mechanism",
         "Completion rate", description="Offers finished (e.g. reached level 10, signed up)."),
    Node("revenue", "Advertiser revenue", "USD/h", "money", "L2", ["completions"], "mechanism",
         "Payout per completion x share the advertiser confirms (postback / acceptance)",
         description="What advertisers pay Almedia."),
    Node("rewards", "User rewards", "USD/h", "money", "L2", ["completions"], "mechanism",
         "Reward per completion (share of payout, promos)", description="What Freecash pays users."),
    Node("quality", "Valuable users delivered", "users/h", "count", "L2", ["completions"], "mechanism",
         "Share of completions that become retained, paying players for the advertiser",
         description="Advertiser-side value (retention / payer index)."),
    Node("margin", "Contribution margin", "USD/h", "money", "L2", ["revenue", "rewards"], "formula",
         expr="revenue - rewards", description="Revenue minus rewards."),
    Node("quality_per_completion", "Quality per completion", "ratio", "ratio", "L2", ["quality", "completions"],
         "formula", expr="quality / completions", aggregation="ratio",
         description="How valuable an average completion is for the advertiser."),
]

KPI_WATCH = ["new_accounts", "completions", "revenue", "rewards", "margin", "quality_per_completion"]


class MetricGraph:
    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {n.id: n for n in CORE_NODES}

    def add(self, node: Node) -> None:
        self.nodes[node.id] = node

    def upstream(self, node_id: str) -> list[str]:
        """All ancestors in topological order (roots first)."""
        seen: list[str] = []

        def visit(n: str) -> None:
            for p in self.nodes[n].parents:
                if p not in seen:
                    visit(p)
            if n not in seen:
                seen.append(n)
        visit(node_id)
        return seen

    def to_dict(self) -> dict:
        nodes = [n.to_dict() for n in self.nodes.values()]
        edges = [{"source": p, "target": n.id, "type": n.edge} for n in self.nodes.values() for p in n.parents]
        edges += [{"source": "calendar", "target": t, "type": "exogenous"} for t in ("active_users", "starts", "rewards")]
        return {"nodes": nodes, "edges": edges,
                "exogenous": [{"id": "calendar", "label": "Planned events (marketing calendar)"}],
                "levels": {"L1": "Global and country totals", "L2": "Country x platform x advertiser category",
                           "L3": "Individual accounts (taste model, on demand)"}}


SAFE_NAME = re.compile(r"^[a-z][a-z0-9_]*$")


def parse_expression(expr: str, known: set[str]) -> tuple[list[str], str]:
    """Validate a metric formula: only + - * / ( ), numbers and known metric names."""
    tree = ast.parse(expr, mode="eval")
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            if node.id not in known:
                raise ValueError(f"unknown metric '{node.id}'")
            if node.id not in names:
                names.append(node.id)
        elif isinstance(node, (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Load,
                               ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub)):
            continue
        else:
            raise ValueError(f"unsupported syntax: {type(node).__name__}")
    has_div = any(isinstance(n, ast.BinOp) and isinstance(n.op, ast.Div) for n in ast.walk(tree))
    return names, ("ratio" if has_div else "sum")


def evaluate(expr: str, values: dict) -> object:
    code = compile(ast.parse(expr, mode="eval"), "<metric>", "eval")
    return eval(code, {"__builtins__": {}}, values)  # noqa: S307 - names/ops validated by parse_expression
