"""
Build the data bundle for the MoDPA network browser.

Reads the filtered association list, the Leiden cluster table and the canonical human FASTA,
and writes site/data/modpa-data.js, which assigns one compact object to window.MODPA_DATA.
A .js file (rather than .json) lets index.html run straight from disk, with no web server,
because browsers block fetch() on file:// URLs but not <script src>.

Only edges with qvalue < QMAX are kept. Scores are stored as integers (Score * 10000) and
q-values with three significant digits, to keep the bundle small.

Usage:
    python scripts/build_data.py \
        --edges  20260910-2327-s1168567929-keen_raman/20261109-cosine-filtered-distances.csv \
        --clusters 20260910-2327-s1168567929-keen_raman/20261109-cosine-Leiden-clusters.csv \
        --fasta  ../MoDPAv1.0/1-quant-pipeline-latest/Human_2026_01_canonical.fasta.gz
"""
import argparse
import gzip
import json
import re
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
QMAX = 0.05

# Unimod ID -> display name. Names follow N-runs-per-ptm.csv.gz, as documented in
# MoDPAv1.0/4-PTM-pairs-annotation/scripts/_common.py; 535 is the LRGG ubiquitin remnant.
UNIMOD = {
    1: "Acetyl",
    7: "Deamidated",
    21: "Phospho",
    23: "Dehydrated",
    34: "Methyl",
    36: "Dimethyl",
    37: "Trimethyl",
    53: "HNE",
    64: "Succinyl",
    299: "Carboxy",
    535: "GG (ubiquitin)",
}


def read_fasta(path):
    """Return {accession: (gene, protein_name, length)} from a UniProt FASTA."""
    opener = gzip.open if str(path).endswith(".gz") else open
    out, acc, gene, name, n = {}, None, "", "", 0
    head = re.compile(r"^>\w+\|([^|]+)\|\S+\s+(.*?)\s+OS=.*?(?:GN=(\S+))?")
    with opener(path, "rt") as fh:
        for line in fh:
            if line.startswith(">"):
                if acc:
                    out[acc] = (gene, name, n)
                m = head.match(line)
                acc, name, gene, n = (m.group(1), m.group(2), m.group(3) or "", 0) if m else (None, "", "", 0)
            else:
                n += len(line.strip())
    if acc:
        out[acc] = (gene, name, n)
    return out


def read_table(path):
    return pd.read_parquet(path) if str(path).endswith(".parquet") else pd.read_csv(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edges", required=True)
    ap.add_argument("--clusters", required=True)
    ap.add_argument("--fasta", required=True)
    ap.add_argument("--out", default=str(ROOT / "site" / "data" / "modpa-data.js"))
    ap.add_argument("--label", default="keen_raman, cosine similarity")
    a = ap.parse_args()

    edges = read_table(a.edges)
    if "potential_artefact" not in edges:  # newer exports drop this column
        edges["potential_artefact"] = False
    edges = edges[edges.qvalue < QMAX]
    # Collapse duplicate and reversed pairs, keeping the highest score.
    key = edges[["nodeA", "nodeB"]].apply(lambda r: "__".join(sorted(r)), axis=1)
    edges = edges.assign(key=key).sort_values("Score", ascending=False).drop_duplicates("key")

    clusters = read_table(a.clusters).set_index("name")
    fasta = read_fasta(a.fasta)

    names = sorted(set(edges.nodeA) | set(edges.nodeB),
                   key=lambda s: (s.split("|")[0], int(s.split("|")[1]), s))
    index = {n: i for i, n in enumerate(names)}

    proteins, nodes = {}, []
    for n in names:
        acc, pos, res, mod = n.split("|")
        cl = int(clusters.LeidenCluster[n]) if n in clusters.index else -1
        if acc not in proteins:
            gene, pname, length = fasta.get(acc, ("", "", 0))
            if not gene and n in clusters.index and isinstance(clusters.Gene[n], str):
                gene = clusters.Gene[n]
            proteins[acc] = [gene or acc, pname, length]
        nodes.append([acc, int(pos), res, int(mod), cl])

    edge_rows = [
        [index[r.nodeA], index[r.nodeB], int(round(r.Score * 10000)),
         float(f"{r.qvalue:.3g}"), 1 if str(r.potential_artefact).lower() == "true" else 0]
        for r in edges.itertuples()
    ]

    unknown = sorted({n[3] for n in nodes} - set(UNIMOD))
    if unknown:
        raise SystemExit(f"Unimod IDs without a display name: {unknown}")

    bundle = {
        "meta": {
            "label": a.label,
            "built": date.today().isoformat(),
            "edgesFile": Path(a.edges).name,
            "clustersFile": Path(a.clusters).name,
            "qmax": QMAX,
            "minScore": round(float(edges.Score.min()), 4),
        },
        "mods": {str(k): v for k, v in UNIMOD.items()},
        "proteins": proteins,
        "nodes": nodes,
        "edges": edge_rows,
    }
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("window.MODPA_DATA=" + json.dumps(bundle, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"{len(nodes)} nodes, {len(edge_rows)} edges, {len(proteins)} proteins -> {out} "
          f"({out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
