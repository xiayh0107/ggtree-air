# Core tree analysis and plot assembly for ggtree-air.

.read_tree_table <- function(path) {
  if (!file.exists(path)) stop("Annotation table not found: ", path, call. = FALSE)
  if (tolower(tools::file_ext(path)) == "csv") {
    utils::read.csv(path, header = TRUE, check.names = FALSE, stringsAsFactors = FALSE)
  } else {
    utils::read.table(path, header = TRUE, check.names = FALSE,
                      stringsAsFactors = FALSE, sep = "", quote = "\"")
  }
}

.plot_palette <- function(n, palette = "colorblind") {
  if (n <= 0L) return(character())
  colorblind <- c("#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00",
                  "#56B4E9", "#F0E442", "#000000")
  values <- switch(palette,
    colorblind = rep(colorblind, length.out = n),
    viridis = grDevices::hcl.colors(n, "Viridis"),
    pastel = grDevices::hcl.colors(n, "Pastel 1"),
    vivid = grDevices::hcl.colors(n, "Dynamic"),
    warm = grDevices::hcl.colors(n, "YlOrRd"),
    cool = grDevices::hcl.colors(n, "BluYl"),
    monochrome = grDevices::gray.colors(n, start = 0.2, end = 0.8),
    rep(colorblind, length.out = n)
  )
  unname(values)
}

#' Analyze a tree and assemble base, intent-driven, and grouped plots.
run_analysis <- function(tree_obj, layout = c("rectangular", "circular"),
                         intents = NULL, group_by = NULL, metadata_by = NULL,
                         tip_column = NULL, group_column = NULL,
                         size_column = NULL, shape_column = NULL,
                         heatmap_columns = NULL, heatmap_width = 0.34,
                         layout_overrides = list(), tip_labels = "auto",
                         palette = "colorblind", plot_theme = "publication",
                         clade_nodes = NULL, clade_labels = NULL, branch_cols = NULL,
                         support_var = NULL) {
  required <- c("ape", "ggtree", "treeio", "ggplot2")
  missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
  if (length(missing) > 0L) {
    stop("Missing required plotting package(s): ", paste(missing, collapse = ", "),
         call. = FALSE)
  }
  if (is.null(tree_obj$tree)) stop("run_analysis() received no tree.", call. = FALSE)

  # ggtree 4.0 still uses one ggplot2 line-size API that newer ggplot2 marks as
  # deprecated. Keep this known upstream lifecycle notice out of user runs.
  old_lifecycle_verbosity <- getOption("lifecycle_verbosity")
  options(lifecycle_verbosity = "quiet")
  on.exit(options(lifecycle_verbosity = old_lifecycle_verbosity), add = TRUE)

  suppressPackageStartupMessages({
    library(ggtree)
    library(ggplot2)
  })
  if (!exists("gtree_layouts", inherits = TRUE)) {
    stop("Renderer bootstrap error: router module was not loaded before analysis.",
         call. = FALSE)
  }

  tree <- tree_obj$tree
  phy <- tree_obj$tree_phylo
  if (is.null(phy)) {
    phy <- if (inherits(tree, "phylo")) tree else ape::as.phylo(tree)
  }

  raw_layout <- as.character(layout)
  resolved_layout <- vapply(raw_layout, resolve_layout, character(1))
  valid <- !is.na(resolved_layout)
  if (!any(valid)) stop("No valid layouts were requested.", call. = FALSE)
  if (any(!valid)) {
    cat("  [router] dropped unknown layouts:", paste(raw_layout[!valid], collapse = ", "), "\n")
  }
  aliases <- raw_layout[valid] != resolved_layout[valid]
  if (any(aliases)) {
    cat("  [router] aliases:",
        paste(paste0(raw_layout[valid][aliases], "→", resolved_layout[valid][aliases]),
              collapse = ", "), "\n")
  }
  layout <- unique(unname(resolved_layout[valid]))

  node_ids <- sort(unique(phy$edge[, 1]))
  requested_clade_nodes <- if (is.null(clade_nodes)) integer() else {
    suppressWarnings(unique(as.integer(clade_nodes)))
  }
  requested_clade_nodes <- requested_clade_nodes[!is.na(requested_clade_nodes)]
  valid_clade_nodes <- intersect(requested_clade_nodes, node_ids)
  invalid_clade_nodes <- setdiff(requested_clade_nodes, valid_clade_nodes)
  valid_clade_labels <- paste0("clade ", seq_along(valid_clade_nodes))
  if (length(clade_labels) > 0L) {
    if (length(clade_labels) != length(requested_clade_nodes)) {
      stop("clade_labels must have one label per requested clade node.", call. = FALSE)
    }
    valid_clade_labels <- as.character(clade_labels[match(valid_clade_nodes, requested_clade_nodes)])
  }
  if (length(invalid_clade_nodes) > 0L) {
    warning("Ignoring invalid internal node id(s): ",
            paste(invalid_clade_nodes, collapse = ", "), call. = FALSE)
  }

  metadata_table <- if (is.null(metadata_by)) NULL else .read_tree_table(metadata_by)
  metadata_heatmap <- NULL
  if (!is.null(metadata_table) && length(heatmap_columns) > 0L) {
    metadata_tip_column <- tip_column %||% names(metadata_table)[1]
    missing_columns <- setdiff(c(metadata_tip_column, heatmap_columns), names(metadata_table))
    if (length(missing_columns) > 0L) {
      stop("Metadata heatmap column(s) not found: ", paste(missing_columns, collapse = ", "),
           call. = FALSE)
    }
    heatmap_rows <- metadata_table[metadata_table[[metadata_tip_column]] %in% phy$tip.label,
                                   c(metadata_tip_column, heatmap_columns), drop = FALSE]
    if (anyDuplicated(heatmap_rows[[metadata_tip_column]])) {
      stop("Metadata contains duplicate tip ids for the heatmap.", call. = FALSE)
    }
    rownames(heatmap_rows) <- as.character(heatmap_rows[[metadata_tip_column]])
    metadata_heatmap <- heatmap_rows[, heatmap_columns, drop = FALSE]
    metadata_heatmap[] <- lapply(metadata_heatmap, function(column) {
      if (is.numeric(column)) column else factor(as.character(column))
    })
  }

  group_table <- NULL
  group_levels <- character()
  tip_annotation <- NULL
  group_source <- group_by
  if (is.null(group_source) && !is.null(group_column)) group_source <- metadata_by
  if (!is.null(group_source)) {
    raw_groups <- if (!is.null(metadata_by)
                     && normalizePath(group_source) == normalizePath(metadata_by)) {
      metadata_table
    } else .read_tree_table(group_source)
    if (ncol(raw_groups) < 2L && is.null(group_column)) {
      stop("Group table needs at least two columns: tip and group.", call. = FALSE)
    }
    tip_name <- tip_column %||% names(raw_groups)[1]
    group_name <- group_column %||% names(raw_groups)[2]
    missing_columns <- setdiff(c(tip_name, group_name), names(raw_groups))
    if (length(missing_columns) > 0L) {
      stop("Grouping column(s) not found: ", paste(missing_columns, collapse = ", "),
           call. = FALSE)
    }
    group_table <- raw_groups[, c(tip_name, group_name), drop = FALSE]
    names(group_table) <- c("tip", "group")
    group_table$tip <- as.character(group_table$tip)
    group_table$group <- as.character(group_table$group)
    if (anyNA(group_table$tip) || anyNA(group_table$group) ||
        any(!nzchar(group_table$tip)) || any(!nzchar(group_table$group))) {
      stop("Group table contains missing or empty tip/group values.", call. = FALSE)
    }
    if (anyDuplicated(group_table$tip)) {
      stop("Each tip may occur only once in the group table; duplicates: ",
           paste(unique(group_table$tip[duplicated(group_table$tip)]), collapse = ", "),
           call. = FALSE)
    }
    unknown <- setdiff(group_table$tip, phy$tip.label)
    if (length(unknown) > 0L) {
      warning("Dropping ", length(unknown), " group rows for unknown tips.", call. = FALSE)
      group_table <- group_table[!group_table$tip %in% unknown, , drop = FALSE]
    }
    if (nrow(group_table) == 0L) stop("No group rows match tree tips.", call. = FALSE)
    missing_groups <- setdiff(phy$tip.label, group_table$tip)
    if (length(missing_groups) > 0L) {
      warning(length(missing_groups), " tree tip(s) have no group assignment.", call. = FALSE)
    }
    group_levels <- unique(group_table$group)
    tip_annotation <- data.frame(
      label = group_table$tip,
      group = factor(group_table$group, levels = group_levels),
      stringsAsFactors = FALSE
    )
  }

  if (!is.null(tip_annotation) && !is.null(metadata_table)
      && (!is.null(size_column) || !is.null(shape_column))) {
    metadata_tip_column <- tip_column %||% names(metadata_table)[1]
    requested_columns <- c(metadata_tip_column, size_column, shape_column)
    requested_columns <- requested_columns[!is.na(requested_columns) & nzchar(requested_columns)]
    missing_columns <- setdiff(requested_columns, names(metadata_table))
    if (length(missing_columns) > 0L) {
      stop("Tip aesthetic metadata column(s) not found: ",
           paste(missing_columns, collapse = ", "), call. = FALSE)
    }
    metadata_index <- match(tip_annotation$label, metadata_table[[metadata_tip_column]])
    if (!is.null(size_column)) {
      point_size <- suppressWarnings(as.numeric(metadata_table[[size_column]][metadata_index]))
      if (all(is.na(point_size))) stop("size_column must contain numeric values.", call. = FALSE)
      tip_annotation$point_size <- point_size
    }
    if (!is.null(shape_column)) {
      tip_annotation$point_shape <- factor(as.character(metadata_table[[shape_column]][metadata_index]))
    }
  }

  tree_used <- tree
  if (is.null(group_source) && length(valid_clade_nodes) > 0L) {
    tree_used <- ggtree::groupClade(tree, .node = valid_clade_nodes)
    group_levels <- make.unique(valid_clade_labels)
    group_table <- data.frame(
      node = valid_clade_nodes,
      group = group_levels,
      stringsAsFactors = FALSE
    )
  }

  n_groups <- length(group_levels)
  if (n_groups > 0L) {
    if (is.null(branch_cols)) {
      branch_cols <- .plot_palette(n_groups, palette)
      names(branch_cols) <- group_levels
    } else {
      branch_cols <- as.character(branch_cols)
      if (is.null(names(branch_cols))) {
        if (length(branch_cols) < n_groups) {
          stop("branch_cols needs at least one color per group.", call. = FALSE)
        }
        branch_cols <- branch_cols[seq_len(n_groups)]
        names(branch_cols) <- group_levels
      } else {
        missing_colors <- setdiff(group_levels, names(branch_cols))
        if (length(missing_colors) > 0L) {
          stop("branch_cols is missing named color(s) for: ",
               paste(missing_colors, collapse = ", "), call. = FALSE)
        }
        branch_cols <- branch_cols[group_levels]
      }
    }
  } else {
    branch_cols <- character()
  }

  palette_for <- function(lay) layout_overrides[[lay]]$palette %||% palette
  theme_for <- function(lay) layout_overrides[[lay]]$plot_theme %||% plot_theme
  has_branch_lengths <- !is.null(phy$edge.length) && all(is.finite(phy$edge.length))
  tip_labels <- match.arg(tolower(tip_labels), c("auto", "show", "hide"))
  show_tip_labels <- tip_labels == "show" || (tip_labels == "auto" && tree_obj$n_tips <= 80L)
  circular_layouts <- c("circular", "fan", "inward_circular", "radial")
  unrooted_layouts <- c("equal_angle", "daylight")

  quiet_ggtree <- function(expression) {
    withCallingHandlers(
      force(expression),
      warning = function(warning) {
        # Compatibility warning emitted by ggtree 4.0 against newer ggplot2.
        if (grepl("Using `size` aesthetic for lines was deprecated", conditionMessage(warning),
                  fixed = TRUE)) {
          invokeRestart("muffleWarning")
        }
      }
    )
  }

  make_base_plot <- function(lay, title = lay, object = tree_used) {
    ignore_lengths <- !has_branch_lengths || lay %in% unrooted_layouts
    plot <- quiet_ggtree(if (ignore_lengths) {
      ggtree::ggtree(object, layout = lay, branch.length = "none")
    } else {
      ggtree::ggtree(object, layout = lay)
    })
    label_layer <- if (!show_tip_labels) {
      NULL
    } else if (lay %in% circular_layouts) {
      ggtree::geom_tiplab2(size = if (tree_obj$n_tips > 40L) 1.8 else 3)
    } else {
      ggtree::geom_tiplab(size = if (tree_obj$n_tips > 40L) 1.8 else 3)
    }
    theme_layer <- switch(theme_for(lay),
      minimal = ggplot2::theme(
        plot.margin = ggplot2::margin(8, 12, 8, 8),
        legend.position = "right",
        legend.key.height = grid::unit(0.35, "cm")
      ),
      compact = ggplot2::theme(
        plot.margin = ggplot2::margin(4, 6, 4, 4),
        legend.position = "bottom",
        legend.text = ggplot2::element_text(size = 7),
        legend.title = ggplot2::element_text(size = 8)
      ),
      ggplot2::theme(
        plot.margin = ggplot2::margin(10, 20, 10, 10),
        legend.position = "right",
        plot.title = ggplot2::element_text(face = "bold", size = 11)
      )
    )
    plot + label_layer + ggplot2::ggtitle(title) + theme_layer
  }

  base_plots <- setNames(lapply(layout, make_base_plot), layout)

  support_candidates <- c(support_var, "bp", "posterior", "prob", "support")
  support_candidates <- support_candidates[!is.na(support_candidates)]
  support_available <- support_candidates[support_candidates %in% names(base_plots[[1]]$data)]

  add_tip_points <- function(plot, default_size = 2.2, colors = branch_cols) {
    attached <- plot %<+% tip_annotation
    has_size <- "point_size" %in% names(tip_annotation)
    has_shape <- "point_shape" %in% names(tip_annotation)
    mapping <- if (has_size && has_shape) {
      ggplot2::aes(color = group, size = point_size, shape = point_shape)
    } else if (has_size) {
      ggplot2::aes(color = group, size = point_size)
    } else if (has_shape) {
      ggplot2::aes(color = group, shape = point_shape)
    } else ggplot2::aes(color = group)
    point_layer <- if (has_size) {
      ggtree::geom_tippoint(mapping, na.rm = TRUE)
    } else {
      ggtree::geom_tippoint(mapping, size = default_size, na.rm = TRUE)
    }
    attached <- attached + point_layer +
      ggplot2::scale_color_manual(values = colors, na.value = "grey70", drop = FALSE)
    if (has_size) attached <- attached + ggplot2::scale_size_continuous(range = c(0.8, 4.2))
    attached
  }

  gallery_rows <- NULL
  intent_plots <- list()
  intent_status <- data.frame(
    goal = character(), status = character(), note = character(),
    stringsAsFactors = FALSE
  )

  if (!is.null(intents) && length(intents) > 0L) {
    gallery_rows <- route_intent(intents)
    goals <- unique(gallery_rows$goal)

    status_for <- function(goal) {
      switch(
        goal,
        support = if (length(support_available) > 0L) {
          c("applied", paste0("internal-node labels from `", support_available[1], "`"))
        } else c("skipped", "no support column was found"),
        tipcolor = if (!is.null(tip_annotation)) c("applied", "tip groups") else
          c("skipped", "a group table is required"),
        hilight = if (length(valid_clade_nodes) > 0L) c("applied", "validated clade nodes") else
          c("skipped", "valid clade_nodes are required"),
        cladelabel = if (length(valid_clade_nodes) > 0L) c("applied", "validated clade nodes") else
          c("skipped", "valid clade_nodes are required"),
        treescale = if (has_branch_lengths) c("applied", "branch-length scale") else
          c("skipped", "tree has no branch lengths"),
        label = c("applied", "included in base plot"),
        circular = if (any(layout %in% circular_layouts)) c("applied", "circular layout requested") else
          c("skipped", "request a circular/fan layout"),
        branchcolor = if (is.null(group_source) && length(valid_clade_nodes) > 0L) {
          c("applied", "groupClade branch groups")
        } else c("skipped", "branch coloring requires clade_nodes"),
        heatmap = if (!is.null(metadata_heatmap) && ncol(metadata_heatmap) > 0L) {
          c("applied", paste(ncol(metadata_heatmap), "metadata columns"))
        } else c("skipped", "metadata and heatmap_columns are required"),
        c("skipped", "recipe is documented but not yet automated by the MVP")
      )
    }
    if (length(goals) > 0L) {
      intent_status <- do.call(rbind, lapply(goals, function(goal) {
        value <- status_for(goal)
        data.frame(goal = goal, status = value[1], note = value[2], stringsAsFactors = FALSE)
      }))
    }

    for (lay in layout) {
      plot <- base_plots[[lay]]
      resolved_palette <- palette_for(lay)
      for (goal in goals) {
        status <- intent_status$status[intent_status$goal == goal][1]
        if (!identical(status, "applied")) next
        plot <- switch(
          goal,
          support = {
            support_name <- support_available[support_available %in% names(plot$data)][1]
            if (is.na(support_name)) plot else
              plot + ggtree::geom_nodelab(
                ggplot2::aes(subset = !isTip, label = .data[[support_name]]),
                na.rm = TRUE, size = 3
              )
          },
          tipcolor = add_tip_points(
            plot, default_size = 2.2,
            colors = stats::setNames(.plot_palette(n_groups, resolved_palette), group_levels)
          ),
          hilight = {
            for (node in valid_clade_nodes) {
              plot <- plot + ggtree::geom_hilight(node = node, fill = "#4F9CF9", alpha = 0.2)
            }
            plot
          },
          cladelabel = {
            for (i in seq_along(valid_clade_nodes)) {
              color <- if (length(branch_cols) > 0L) unname(branch_cols[(i - 1L) %% length(branch_cols) + 1L]) else "grey30"
              plot <- plot + ggtree::geom_cladelabel(
                node = valid_clade_nodes[i], label = valid_clade_labels[i],
                color = color, offset = 0.03
              )
            }
            plot
          },
          treescale = if (lay %in% unrooted_layouts) plot else plot + ggtree::geom_treescale(),
          heatmap = if (lay %in% unrooted_layouts) {
            plot
          } else {
            tree_span <- diff(range(plot$data$x, finite = TRUE))
            resolved_heatmap_width <- as.numeric(
              layout_overrides[[lay]]$heatmap_width %||% heatmap_width
            )
            add_heatmap <- function(base_plot, data, width, legend_name) {
              suppressMessages(withCallingHandlers(
                ggtree::gheatmap(
                  base_plot, data,
                  offset = max(tree_span * 0.04, 0.001),
                  width = width,
                  colnames = ncol(data) > 1L,
                  font.size = if (tree_obj$n_tips > 100L) 1.8 else 3
                ),
                warning = function(warning) {
                  if (grepl("attributes are not identical across measure variables",
                            conditionMessage(warning), fixed = TRUE)) {
                    invokeRestart("muffleWarning")
                  }
                }
              ))
            }
            numeric_columns <- names(metadata_heatmap)[vapply(metadata_heatmap, is.numeric, logical(1))]
            categorical_columns <- setdiff(names(metadata_heatmap), numeric_columns)
            if (length(numeric_columns) > 0L && length(categorical_columns) > 0L
                && requireNamespace("ggnewscale", quietly = TRUE)) {
              heatmap_plot <- suppressMessages(
                add_heatmap(plot, metadata_heatmap[, numeric_columns, drop = FALSE],
                            width = resolved_heatmap_width * 0.53, legend_name = "numeric") +
                  ggplot2::scale_fill_gradientn(
                    colors = .plot_palette(9, resolved_palette), name = paste(numeric_columns, collapse = ", ")
                  ) + ggnewscale::new_scale_fill()
              )
              category_values <- unique(unlist(lapply(
                metadata_heatmap[, categorical_columns, drop = FALSE], as.character)))
              suppressMessages(
                add_heatmap(heatmap_plot,
                            metadata_heatmap[, categorical_columns, drop = FALSE],
                            width = resolved_heatmap_width * 0.47, legend_name = "category") +
                  ggplot2::scale_fill_manual(
                    values = stats::setNames(
                      .plot_palette(length(category_values), resolved_palette), category_values),
                    na.value = "grey90", name = paste(categorical_columns, collapse = ", ")
                  )
              )
            } else {
              heatmap_plot <- add_heatmap(plot, metadata_heatmap, width = resolved_heatmap_width,
                                          legend_name = "value")
              if (length(categorical_columns) == 0L) {
                suppressMessages(heatmap_plot + ggplot2::scale_fill_gradientn(
                  colors = .plot_palette(9, resolved_palette), name = "value"
                ))
              } else {
                heatmap_values <- unique(unlist(lapply(metadata_heatmap, as.character)))
                suppressMessages(heatmap_plot + ggplot2::scale_fill_manual(
                  values = stats::setNames(
                    .plot_palette(length(heatmap_values), resolved_palette), heatmap_values),
                  na.value = "grey90", name = "value"
                ))
              }
            }
          },
          branchcolor = plot,
          plot
        )
      }
      intent_plots[[lay]] <- plot + ggplot2::ggtitle(paste(lay, "· recommended figure"))
    }
  }

  annotated_plots <- list()
  if (!is.null(tip_annotation)) {
    for (lay in layout) {
      annotated_plots[[lay]] <- add_tip_points(
        base_plots[[lay]], default_size = 2.4,
        colors = stats::setNames(.plot_palette(n_groups, palette_for(lay)), group_levels)
      ) + ggplot2::ggtitle(paste(lay, "· metadata groups"))
    }
  } else if (length(valid_clade_nodes) > 0L) {
    for (lay in layout) {
      ignore_lengths <- !has_branch_lengths || lay %in% unrooted_layouts
      plot <- if (ignore_lengths) {
        ggtree::ggtree(tree_used, ggplot2::aes(color = factor(group)), layout = lay,
                       branch.length = "none")
      } else {
        ggtree::ggtree(tree_used, ggplot2::aes(color = factor(group)), layout = lay)
      }
      label_layer <- if (lay %in% circular_layouts) ggtree::geom_tiplab2(size = 3) else
        ggtree::geom_tiplab(size = 3)
      annotated_plots[[lay]] <- plot + label_layer +
        ggplot2::scale_color_manual(
          values = c("grey70", .plot_palette(n_groups, palette_for(lay))),
          na.value = "grey70"
        ) +
        ggplot2::ggtitle(paste(lay, "· clade groups"))
    }
  }

  cat("✓ Tree analysis completed successfully\n")
  cat("  Layouts:", paste(layout, collapse = ", "),
      "| internal nodes:", length(node_ids),
      "| groups:", n_groups,
      "| routed intents:", if (is.null(gallery_rows)) 0L else nrow(gallery_rows), "\n")

  list(
    base_plots = base_plots,
    intent_plots = intent_plots,
    gallery = gallery_rows,
    intent_status = intent_status,
    annotated_plots = annotated_plots,
    tree = tree,
    tree_phylo = phy,
    tree_used = tree_used,
    node_ids = node_ids,
    group_table = group_table,
    metadata_table = metadata_table,
    heatmap_columns = heatmap_columns,
    group_levels = group_levels,
    clade_nodes = valid_clade_nodes,
    clade_labels = valid_clade_labels,
    invalid_clade_nodes = invalid_clade_nodes,
    branch_cols = branch_cols,
    layout = layout,
    route = tree_obj$route,
    rooted = isTRUE(tree_obj$rooted),
    outgroup = tree_obj$outgroup,
    dist_matrix = tree_obj$dist_matrix,
    alignment = tree_obj$alignment,
    warnings = tree_obj$warnings,
    meta = list(
      n_tips = tree_obj$n_tips,
      n_nodes = tree_obj$n_nodes,
      input_path = tree_obj$input_path,
      input_md5 = tree_obj$input_md5,
      sequence_type = tree_obj$sequence_type
    ),
    parameters = list(
      layouts = layout,
      intents = as.character(if (is.null(intents)) character() else intents),
      group_by = if (is.null(group_source)) NULL else normalizePath(group_source, mustWork = TRUE),
      metadata_by = if (is.null(metadata_by)) NULL else normalizePath(metadata_by, mustWork = TRUE),
      tip_column = tip_column,
      group_column = group_column,
      size_column = size_column,
      shape_column = shape_column,
      heatmap_columns = as.character(heatmap_columns %||% character()),
      heatmap_width = heatmap_width,
      layout_overrides = layout_overrides,
      tip_labels = tip_labels,
      show_tip_labels = show_tip_labels,
      palette = palette,
      plot_theme = plot_theme,
      clade_nodes = valid_clade_nodes,
      clade_labels = valid_clade_labels,
      support_var = support_var,
      sequence_type = tree_obj$sequence_type,
      branch_colors = as.list(branch_cols)
    )
  )
}
