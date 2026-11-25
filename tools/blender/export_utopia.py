"""
KitBash3D Utopia -> runtime LOD GLBs.

Run headless (Blender 4.x):
  blender --background --factory-startup --python tools/blender/export_utopia.py -- \
      --src "/path/to/KB3D_Utopia/KB3D_UTP_Blender.blend"   (or the kit's .fbx / .usd)
      --out assets-private/export
Options:
  --lod-ratios 1.0,0.3,0.08   decimation ratio per LOD (LOD0 = original geometry)
  --unit-scale auto|<float>   metres per source unit (auto detects centimetre kits)
  --include REGEX             only models whose name matches

Output (never commit or publish – licensed source-derived data):
  <out>/utopia_lod0.glb, utopia_lod1.glb, utopia_lod2.glb   one node per building, base centred at origin
  <out>/index.json                                         heights, footprints, triangle counts
One file per LOD keeps the kit's shared PBR materials/textures deduplicated.
"""
import bpy, bmesh, sys, os, re, json, math, argparse
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--out", default="assets-private/export")
ap.add_argument("--lod-ratios", default="1.0,0.3,0.08")
ap.add_argument("--unit-scale", default="auto")
ap.add_argument("--include", default="")
ap.add_argument("--kit", default="KitBash3D Utopia", help='display name, e.g. "KitBash3D Neo City"')
args = ap.parse_args(argv)
ratios = [float(r) for r in args.lod_ratios.split(",")]
os.makedirs(args.out, exist_ok=True)

# ------------------------------------------------------------------ import
bpy.ops.wm.read_factory_settings(use_empty=True)
src = os.path.abspath(args.src)
ext = os.path.splitext(src)[1].lower()
if ext == ".blend":
    with bpy.data.libraries.load(src, link=False) as (data_from, data_to):
        data_to.objects = list(data_from.objects)
    for o in data_to.objects:
        if o is not None:
            bpy.context.scene.collection.objects.link(o)
elif ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=src, use_image_search=True)
elif ext in (".usd", ".usda", ".usdc", ".usdz"):
    bpy.ops.wm.usd_import(filepath=src)
else:
    sys.exit(f"Unsupported source format: {ext}")
print(f"[utopia] imported {len(bpy.data.objects)} objects from {src}")

def descendants(o):
    out = [o]
    for c in o.children:
        out += descendants(c)
    return out

def mesh_objs(root):
    return [o for o in descendants(root) if o.type == "MESH"]

# a "building" = top-level object whose hierarchy contains geometry
roots = [o for o in bpy.context.scene.objects if o.parent is None and mesh_objs(o)]
# layout scenes may contain many instances of the same model: keep the first of each base name
seen, unique = set(), []
for r in sorted(roots, key=lambda o: o.name):
    base = re.sub(r"\.\d{3}$", "", r.name)
    if base in seen:
        continue
    if args.include and not re.search(args.include, base, re.I):
        continue
    seen.add(base)
    unique.append(r)
print(f"[utopia] {len(unique)} unique models")

def world_bbox(objs):
    mn = Vector((1e18,) * 3); mx = Vector((-1e18,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    return mn, mx

# unit detection (KitBash FBX is frequently in centimetres)
if args.unit_scale == "auto":
    hs = [world_bbox(mesh_objs(r))[1].z - world_bbox(mesh_objs(r))[0].z for r in unique]
    unit = 0.01 if hs and max(hs) > 3000 else 1.0
else:
    unit = float(args.unit_scale)
print(f"[utopia] unit scale {unit} m/unit")

def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"^KB3D_[A-Z]+_", "", name).lower()).strip("-")

lod_cols = []
for l in range(len(ratios)):
    col = bpy.data.collections.new(f"LOD{l}")
    bpy.context.scene.collection.children.link(col)
    lod_cols.append(col)

def tri_count(obj):
    me = obj.data
    return sum(len(p.vertices) - 2 for p in me.polygons)

index = []
for r in unique:
    meshes = mesh_objs(r)
    mn, mx = world_bbox(meshes)
    centre = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    # duplicate, realise, join into one object (materials preserved as slots)
    dups = []
    for o in meshes:
        d = o.copy(); d.data = o.data.copy()
        d.parent = None
        d.matrix_world = o.matrix_world.copy()
        lod_cols[0].objects.link(d)
        dups.append(d)
    bpy.ops.object.select_all(action="DESELECT")
    for d in dups:
        d.select_set(True)
    bpy.context.view_layer.objects.active = dups[0]
    if len(dups) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # base centre -> origin, metres
    obj.data.transform(__import__("mathutils").Matrix.Translation(-centre))
    obj.location = (0, 0, 0)
    obj.scale = (unit, unit, unit)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sid = slug(re.sub(r"\.\d{3}$", "", r.name))
    obj.name = sid
    radius = max((math.hypot(v.co.x, v.co.y) for v in obj.data.vertices), default=1.0)
    height = max((v.co.z for v in obj.data.vertices), default=1.0)
    tris = [tri_count(obj)]
    for l, ratio in enumerate(ratios[1:], start=1):
        c = obj.copy(); c.data = obj.data.copy(); c.name = f"{sid}__lod{l}"
        lod_cols[l].objects.link(c)
        m = c.modifiers.new("decimate", "DECIMATE")
        m.decimate_type = "COLLAPSE"; m.ratio = ratio; m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = c
        bpy.ops.object.select_all(action="DESELECT"); c.select_set(True)
        bpy.ops.object.modifier_apply(modifier=m.name)
        tris.append(tri_count(c))
    index.append({"id": sid, "name": r.name, "node": sid, "height": round(height, 2), "radius": round(radius, 2), "triangles": tris})
    print(f"[utopia] {sid:40s} h={height:7.1f} m  r={radius:6.1f} m  tris={tris}")

# hide the original hierarchy, export one GLB per LOD collection
for o in bpy.context.scene.objects:
    if not any(o.name in col.objects for col in lod_cols):
        o.hide_set(True); o.hide_render = True
for l, col in enumerate(lod_cols):
    lc = bpy.context.view_layer.layer_collection.children[col.name]
    bpy.context.view_layer.active_layer_collection = lc
    path = os.path.join(args.out, f"utopia_lod{l}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_active_collection=True,
                              export_apply=True, export_yup=True, export_image_format="AUTO",
                              export_materials="EXPORT", export_cameras=False, export_lights=False)
    print(f"[utopia] wrote {path}")

with open(os.path.join(args.out, "index.json"), "w") as f:
    json.dump({"kit": args.kit, "unit": unit, "lods": len(ratios), "models": index}, f, indent=2)
print("[utopia] done")
