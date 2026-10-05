"""Calendar-aligned, label-purged splits shared by every symbol."""
import numpy as np
import pandas as pd


def split_by_date(rows):
    dates = rows.index.unique().sort_values()
    if len(dates) < 30: raise ValueError("Insufficient dates for three disjoint periods")
    selection_start, final_start = dates[int(len(dates)*0.6)], dates[int(len(dates)*0.8)]
    train = rows[(rows.index < selection_start) & (rows.label_end < selection_start)]
    selection = rows[(rows.index >= selection_start) & (rows.index < final_start) & (rows.label_end < final_start)]
    final = rows[rows.index >= final_start]
    if any(x.empty for x in (train, selection, final)): raise ValueError("Empty split after purge")
    return train, selection, final


def sequences(rows, columns, length=30):
    xs, ys = [], []
    for _, group in rows.groupby("symbol"):
        group = group.sort_index()
        for end in range(length-1,len(group)):
            block = group.iloc[end-length+1:end+1]
            xs.append(block[columns].to_numpy(dtype=np.float64))
            ys.append(float(block.label.iloc[-1] == "UP"))
    if not xs: raise ValueError("Insufficient within-partition sequences")
    return np.stack(xs), np.array(ys, dtype=np.float64)
