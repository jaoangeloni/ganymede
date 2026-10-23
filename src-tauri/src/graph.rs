use std::{
    collections::{HashMap, HashSet},
    thread,
};

use crate::{error::Result, store::Store};

const K: usize = 5;
const MIN_SIMILARITY: f32 = 0.6;

pub type Neighbors = Vec<(String, f32)>;

struct Vector {
    scale: f32,
    values: Vec<i8>,
}

fn unpack(bytes: &[u8]) -> Option<Vector> {
    let scale = f32::from_le_bytes(bytes.get(..4)?.try_into().ok()?);
    Some(Vector { scale, values: bytes[4..].iter().map(|&byte| byte as i8).collect() })
}

fn similarity(a: &Vector, b: &Vector) -> f32 {
    let dot: i32 = a.values.iter().zip(&b.values).map(|(&x, &y)| i32::from(x) * i32::from(y)).sum();
    dot as f32 * a.scale * b.scale / (127.0 * 127.0)
}

fn offer(list: &mut Neighbors, id: &str, value: f32, size: usize) -> bool {
    if list.iter().any(|(other, _)| other == id)
        || (list.len() >= size && list.last().is_some_and(|(_, worst)| value <= *worst))
    {
        return false;
    }
    let at = list.iter().position(|(_, other)| value > *other).unwrap_or(list.len());
    list.insert(at, (id.to_string(), value));
    list.truncate(size);
    true
}

fn nearest(index: usize, ids: &[String], vectors: &[Vector], size: usize) -> Neighbors {
    let mut list = Neighbors::with_capacity(size + 1);
    for (j, vector) in vectors.iter().enumerate() {
        if j != index {
            offer(&mut list, &ids[j], similarity(&vectors[index], vector), size);
        }
    }
    list
}

fn all_nearest(ids: &[String], vectors: &[Vector], size: usize) -> Vec<Neighbors> {
    let workers = thread::available_parallelism().map_or(1, |n| n.get()).min(ids.len().max(1));
    let chunk = ids.len().div_ceil(workers);
    thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|w| {
                scope.spawn(move || {
                    (w * chunk..((w + 1) * chunk).min(ids.len()))
                        .map(|i| nearest(i, ids, vectors, size))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles.into_iter().flat_map(|handle| handle.join().unwrap_or_default()).collect()
    })
}

fn sparse_edges(
    ids: &[String],
    vectors: &[Vector],
    lists: &mut HashMap<String, Neighbors>,
) -> (Vec<(usize, usize, f32)>, HashSet<usize>) {
    let n = ids.len();
    let size = K.min(n.saturating_sub(1));
    let index: HashMap<&str, usize> = ids.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    let valid = |list: &Neighbors| list.len() == size && list.iter().all(|(id, _)| index.contains_key(id.as_str()));
    let stale: Vec<usize> = (0..n).filter(|&i| !lists.get(&ids[i]).is_some_and(valid)).collect();
    let mut changed = HashSet::new();
    if stale.len() * 4 > n {
        for (i, list) in all_nearest(ids, vectors, size).into_iter().enumerate() {
            lists.insert(ids[i].clone(), list);
            changed.insert(i);
        }
    } else {
        for &s in &stale {
            let mut own = Neighbors::with_capacity(size + 1);
            for j in (0..n).filter(|&j| j != s) {
                let value = similarity(&vectors[s], &vectors[j]);
                offer(&mut own, &ids[j], value, size);
                if let Some(other) = lists.get_mut(&ids[j]) {
                    if offer(other, &ids[s], value, size) {
                        changed.insert(j);
                    }
                }
            }
            lists.insert(ids[s].clone(), own);
            changed.insert(s);
        }
    }
    let mut pairs = HashMap::new();
    for (i, id) in ids.iter().enumerate() {
        for (other, value) in &lists[id] {
            let j = index[other.as_str()];
            if *value >= MIN_SIMILARITY {
                pairs.insert((i.min(j), i.max(j)), *value);
            }
        }
    }
    let mut edges: Vec<_> = pairs.into_iter().map(|((a, b), value)| (a, b, value)).collect();
    edges.sort_by_key(|&(a, b, _)| (a, b));
    (edges, changed)
}

pub fn edges(store: &Store, space: &str, ids: &[String]) -> Result<Vec<(u32, u32, f32)>> {
    let (mut embedded, mut vectors, mut origin) = (Vec::new(), Vec::new(), Vec::new());
    for (i, (id, bytes)) in ids.iter().zip(store.embeddings(ids)?).enumerate() {
        if let Some(vector) = bytes.as_deref().and_then(unpack) {
            embedded.push(id.clone());
            vectors.push(vector);
            origin.push(i as u32);
        }
    }
    if embedded.len() < 2 {
        return Ok(Vec::new());
    }
    let mut lists = store.neighbors(space)?;
    let (edges, changed) = sparse_edges(&embedded, &vectors, &mut lists);
    if !changed.is_empty() {
        store.save_neighbors(space, changed.iter().map(|&i| (&embedded[i], &lists[&embedded[i]])))?;
    }
    Ok(edges.into_iter().map(|(a, b, value)| (origin[a], origin[b], value)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vector(values: &[f32]) -> Vector {
        unpack(&crate::vision::quantize(values)).unwrap()
    }

    fn ids(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("r{i}")).collect()
    }

    #[test]
    fn quantized_keeps_the_cosine() {
        let (a, b) = ([0.6f32, 0.8, 0.0], [0.8f32, 0.6, 0.0]);
        assert!((similarity(&vector(&a), &vector(&b)) - 0.96).abs() < 0.01);
    }

    fn spiral(n: usize) -> Vec<Vector> {
        (0..n)
            .map(|i| {
                let t = i as f32 * 0.37;
                let v = [t.cos(), t.sin(), (t * 0.5).cos()];
                let norm = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
                vector(&[v[0] / norm, v[1] / norm, v[2] / norm])
            })
            .collect()
    }

    fn pairs(edges: &[(usize, usize, f32)], ids: &[String]) -> HashSet<(String, String)> {
        edges.iter().map(|&(a, b, _)| (ids[a].clone(), ids[b].clone())).collect()
    }

    #[test]
    fn links_the_top_k_of_either_end_above_the_minimum() {
        let vectors: Vec<Vector> =
            [[1.0, 0.0], [0.99, 0.14], [0.97, 0.24], [0.0, 1.0], [0.14, 0.99]].iter().map(|v| vector(v)).collect();
        let (edges, _) = sparse_edges(&ids(5), &vectors, &mut HashMap::new());
        let found: HashSet<(usize, usize)> = edges.iter().map(|&(a, b, _)| (a, b)).collect();
        assert!(found.contains(&(0, 1)) && found.contains(&(3, 4)));
        assert!(!found.contains(&(0, 3)), "similarity below the minimum is not an edge");
        assert!(edges.iter().all(|&(a, b, _)| a < b));
    }

    #[test]
    fn backfill_links_nodes_that_only_appear_in_the_other_top_k() {
        let mut raw = vec![[1.0f32, 0.0, 0.0]];
        raw.extend((0..8).map(|k| {
            let t = k as f32 * std::f32::consts::FRAC_PI_4;
            let norm = 1.25f32.sqrt();
            [1.0 / norm, 0.5 * t.cos() / norm, 0.5 * t.sin() / norm]
        }));
        let vectors: Vec<Vector> = raw.iter().map(|v| vector(v)).collect();
        let mut lists = HashMap::new();
        let (edges, changed) = sparse_edges(&ids(9), &vectors, &mut lists);
        assert_eq!(changed.len(), 9);
        assert_eq!(lists["r0"].len(), K);
        let hub = edges.iter().filter(|&&(a, _, _)| a == 0).count();
        assert!(hub > K, "node 0 is in everyone's top-K: the union exceeds K");
    }

    #[test]
    fn adding_matches_a_full_recompute() {
        let vectors = spiral(40);
        let mut lists = HashMap::new();
        sparse_edges(&ids(39), &vectors[..39], &mut lists);
        let (incremental, changed) = sparse_edges(&ids(40), &vectors, &mut lists);
        assert!(changed.len() < 40);
        let (full, _) = sparse_edges(&ids(40), &vectors, &mut HashMap::new());
        assert_eq!(pairs(&incremental, &ids(40)), pairs(&full, &ids(40)));
    }

    #[test]
    fn removing_recomputes_only_who_lost_a_neighbor() {
        let vectors = spiral(80);
        let mut lists = HashMap::new();
        sparse_edges(&ids(80), &vectors, &mut lists);
        let had: HashSet<String> =
            lists.iter().filter(|(_, list)| list.iter().any(|(id, _)| id == "r7")).map(|(id, _)| id.clone()).collect();
        lists.remove("r7");
        let kept: Vec<String> = ids(80).into_iter().filter(|id| id != "r7").collect();
        let rest: Vec<Vector> = vectors.into_iter().enumerate().filter(|&(i, _)| i != 7).map(|(_, v)| v).collect();
        let (incremental, changed) = sparse_edges(&kept, &rest, &mut lists);
        let recomputed: HashSet<String> = changed.iter().map(|&i| kept[i].clone()).collect();
        assert!(!had.is_empty() && recomputed.is_subset(&had));
        let (full, _) = sparse_edges(&kept, &rest, &mut HashMap::new());
        assert_eq!(pairs(&incremental, &kept), pairs(&full, &kept));
    }

    #[test]
    fn repeating_changes_nothing() {
        let vectors = spiral(30);
        let mut lists = HashMap::new();
        let (first, _) = sparse_edges(&ids(30), &vectors, &mut lists);
        let (again, changed) = sparse_edges(&ids(30), &vectors, &mut lists);
        assert!(changed.is_empty());
        assert_eq!(
            first.iter().map(|&(a, b, _)| (a, b)).collect::<Vec<_>>(),
            again.iter().map(|&(a, b, _)| (a, b)).collect::<Vec<_>>()
        );
    }
}
