# Extract a machine-readable semantic scene from a ggtree-air result.
#
# Coordinates are projected through ggplot's active coordinate system and the
# rendered panel viewport into normalized artifact coordinates. They are not
# guessed from pixels, so tip/node identity survives layout-specific rendering.

.scene_scalar <- function(value) {
  if (length(value) == 0L || is.na(value) || !is.finite(if (is.numeric(value)) value else 0)) {
    return(NULL)
  }
  unname(value)
}

.scene_scale <- function(value, limits) {
  span <- limits[2] - limits[1]
  if (!is.finite(span) || span == 0) return(rep(0.5, length(value)))
  (value - limits[1]) / span
}

.scene_quiet_plot <- function(expression) {
  old_lifecycle <- getOption("lifecycle_verbosity")
  options(lifecycle_verbosity = "quiet")
  on.exit(options(lifecycle_verbosity = old_lifecycle), add = TRUE)
  withCallingHandlers(
    force(expression),
    warning = function(warning) {
      if (grepl("Unknown or uninitialised column: `subgroup`", conditionMessage(warning),
                fixed = TRUE)
          || grepl("Using `size` aesthetic for lines was deprecated", conditionMessage(warning),
                   fixed = TRUE)
          || grepl("The following aesthetics were dropped during statistical transformation",
                   conditionMessage(warning), fixed = TRUE)) {
        invokeRestart("muffleWarning")
      }
    }
  )
}

.scene_panel_bounds <- function(plot, width_in, height_in) {
  previous_device <- grDevices::dev.cur()
  grDevices::pdf(NULL, width = width_in, height = height_in)
  on.exit({
    if (grDevices::dev.cur() != previous_device) grDevices::dev.off()
  }, add = TRUE)
  .scene_quiet_plot({
    grid::grid.newpage()
    grid::grid.draw(plot)
    grid::grid.force()
  })
  viewports <- grid::grid.ls(viewports = TRUE, grobs = FALSE, print = FALSE)
  panel_names <- viewports$name[grepl("^panel[.]", viewports$name)]
  if (length(panel_names) == 0L) {
    return(list(left = 0, top = 0, width = 1, height = 1))
  }
  grid::seekViewport(panel_names[1])
  bottom_left <- grid::deviceLoc(grid::unit(0, "npc"), grid::unit(0, "npc"),
                                 valueOnly = TRUE)
  top_right <- grid::deviceLoc(grid::unit(1, "npc"), grid::unit(1, "npc"),
                               valueOnly = TRUE)
  list(
    left = unname(bottom_left$x / width_in),
    top = unname(1 - top_right$y / height_in),
    width = unname((top_right$x - bottom_left$x) / width_in),
    height = unname((top_right$y - bottom_left$y) / height_in)
  )
}

.scene_render_spec <- function(output_dir) {
  path <- file.path(output_dir, "render_metadata.json")
  if (!file.exists(path) || !requireNamespace("jsonlite", quietly = TRUE)) {
    return(list(width_in = 10, height_in = 8, dpi = 300))
  }
  value <- jsonlite::read_json(path, simplifyVector = TRUE)
  list(
    width_in = as.numeric(value$width_in),
    height_in = as.numeric(value$height_in),
    dpi = as.numeric(value$dpi)
  )
}

.scene_tree_hash <- function(tree) {
  temporary <- tempfile(fileext = ".nwk")
  on.exit(unlink(temporary), add = TRUE)
  phy <- if (inherits(tree, "phylo")) tree else ape::as.phylo(tree)
  ape::write.tree(phy, file = temporary)
  unname(as.character(tools::md5sum(temporary)))
}

#' Write scene.json for a completed analysis.
#'
#' @param result Output of run_analysis().
#' @param output_dir Directory containing rendered artifacts.
#' @return Invisible path to scene.json.
extract_scene <- function(result, output_dir = "results") {
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("Package `jsonlite` is required for scene extraction.", call. = FALSE)
  }
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  output_dir <- normalizePath(output_dir, mustWork = TRUE)

  tip_groups <- character()
  if (!is.null(result$group_table) && all(c("tip", "group") %in% names(result$group_table))) {
    tip_groups <- setNames(as.character(result$group_table$group),
                           as.character(result$group_table$tip))
  }
  support_names <- c("bp", "posterior", "prob", "support")
  render_spec <- .scene_render_spec(output_dir)

  views <- lapply(result$layout, function(layout) {
    variant <- if (!is.null(result$intent_plots[[layout]])) {
      "intents"
    } else if (!is.null(result$annotated_plots[[layout]])) {
      "annotated"
    } else "base"
    plot <- switch(variant,
      intents = result$intent_plots[[layout]],
      annotated = result$annotated_plots[[layout]],
      result$base_plots[[layout]]
    )
    data <- as.data.frame(plot$data)
    required <- c("node", "parent", "isTip", "x", "y")
    missing <- setdiff(required, names(data))
    if (length(missing) > 0L) {
      stop("ggtree plot data is missing scene field(s): ", paste(missing, collapse = ", "),
           call. = FALSE)
    }
    data <- data[order(data$node), , drop = FALSE]
    x_limits <- range(data$x, finite = TRUE)
    y_limits <- range(data$y, finite = TRUE)
    normalized_x <- .scene_scale(data$x, x_limits)
    normalized_y <- .scene_scale(data$y, y_limits)
    built <- .scene_quiet_plot(ggplot2::ggplot_build(plot))
    projected <- .scene_quiet_plot(
      built$layout$coord$transform(data, built$layout$panel_params[[1]])
    )
    panel <- .scene_panel_bounds(plot, render_spec$width_in, render_spec$height_in)
    artifact_x <- panel$left + projected$x * panel$width
    artifact_y <- panel$top + (1 - projected$y) * panel$height

    nodes <- lapply(seq_len(nrow(data)), function(i) {
      label <- if ("label" %in% names(data) && !is.na(data$label[i])) {
        as.character(data$label[i])
      } else NULL
      kind <- if (isTRUE(data$isTip[i])) "tip" else "internal_node"
      support_name <- support_names[support_names %in% names(data)][1]
      support <- if (!is.na(support_name)) .scene_scalar(data[[support_name]][i]) else NULL
      group <- if (!is.null(label) && label %in% names(tip_groups)) unname(tip_groups[[label]]) else NULL
      list(
        id = paste0("node:", as.integer(data$node[i])),
        node = as.integer(data$node[i]),
        parent = as.integer(data$parent[i]),
        kind = kind,
        label = label,
        group = group,
        support = support,
        coordinate = list(
          x = unname(data$x[i]),
          y = unname(data$y[i]),
          angle = if ("angle" %in% names(data)) .scene_scalar(data$angle[i]) else NULL
        ),
        artifact_coordinate = list(
          x = unname(artifact_x[i]),
          y = unname(artifact_y[i])
        ),
        selector = if (kind == "tip") {
          list(kind = "tip", label = label, node = as.integer(data$node[i]))
        } else {
          list(kind = "clade", node = as.integer(data$node[i]))
        }
      )
    })

    edge_rows <- which(data$node != data$parent)
    edges <- lapply(edge_rows, function(i) {
      branch_length <- if ("branch.length" %in% names(data)) {
        .scene_scalar(data$branch.length[i])
      } else NULL
      list(
        id = paste0("edge:", as.integer(data$parent[i]), "->", as.integer(data$node[i])),
        source = paste0("node:", as.integer(data$parent[i])),
        target = paste0("node:", as.integer(data$node[i])),
        branch_length = branch_length
      )
    })

    regions <- lapply(seq_len(nrow(data)), function(i) {
      list(
        id = paste0("region:node:", as.integer(data$node[i])),
        scene_item = paste0("node:", as.integer(data$node[i])),
        binding_method = "ggplot-coordinate-transform",
        coordinate_space = "normalized-artifact",
        center = list(x = unname(artifact_x[i]), y = unname(artifact_y[i])),
        tree_space_center = list(x = unname(normalized_x[i]), y = unname(1 - normalized_y[i])),
        hit_radius = if (isTRUE(data$isTip[i])) 0.014 else 0.012
      )
    })

    image <- file.path(output_dir, paste0(
      "tree_", layout,
      if (variant == "intents") "_intents" else if (variant == "annotated") "_annotated" else "",
      ".png"
    ))
    list(
      id = paste0("view:", layout),
      layout = layout,
      variant = variant,
      coordinate_system = if (layout %in% c("circular", "fan", "inward_circular", "radial")) {
        "polar-projection-of-tree-space"
      } else if (layout %in% c("equal_angle", "daylight")) {
        "unrooted-tree-space"
      } else "cartesian-tree-space",
      bounds = list(x = unname(x_limits), y = unname(y_limits)),
      panel_region = panel,
      artifact = if (file.exists(image)) list(
        path = basename(image),
        md5 = unname(as.character(tools::md5sum(image)))
      ) else NULL,
      nodes = nodes,
      edges = edges,
      artifact_regions = regions
    )
  })

  tree_hash <- .scene_tree_hash(result$tree_phylo)
  scene <- list(
    schema_version = "1.2.0",
    created = if (exists("ggtree_air_iso_time", mode = "function")) {
      ggtree_air_iso_time()
    } else format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    scene_id = paste0("tree:", tree_hash),
    tree = list(
      hash = tree_hash,
      tips = result$meta$n_tips,
      internal_nodes = result$meta$n_nodes,
      rooted = isTRUE(result$rooted),
      input = list(
        path = result$meta$input_path,
        md5 = result$meta$input_md5,
        route = result$route
      )
    ),
    views = views
  )

  output <- file.path(output_dir, "scene.json")
  if (exists("ggtree_air_write_json", mode = "function")) {
    ggtree_air_write_json(scene, output)
  } else {
    writeLines(jsonlite::toJSON(scene, auto_unbox = TRUE, null = "null", na = "null",
                                dataframe = "rows", pretty = TRUE, digits = NA), output)
  }
  cat("✓ Semantic scene extracted to", output, "\n")
  invisible(output)
}
