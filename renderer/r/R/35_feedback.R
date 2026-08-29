# Compile structured human feedback into deterministic ggtree overlay layers.

.feedback_color <- function(intent) {
  switch(intent,
    highlight = "#1769E0",
    color = "#E5484D",
    label = "#1769E0",
    question = "#E8A23A",
    other = "#667085",
    "#1769E0"
  )
}

.feedback_short_label <- function(index, instruction, max_chars = 34L) {
  instruction <- trimws(as.character(instruction))
  if (nchar(instruction) > max_chars) {
    instruction <- paste0(substr(instruction, 1L, max_chars - 1L), "…")
  }
  paste0(index, ". ", instruction)
}

apply_feedback_overlays <- function(result, feedback = NULL) {
  if (is.null(feedback) || length(feedback$annotations) == 0L) {
    return(list(result = result, status = data.frame(
      id = character(), status = character(), note = character(),
      stringsAsFactors = FALSE
    )))
  }

  status_rows <- vector("list", length(feedback$annotations))
  for (i in seq_along(feedback$annotations)) {
    annotation <- feedback$annotations[[i]]
    id <- as.character(annotation$id %||% paste0("feedback-", i))
    layout <- sub("^view:", "", as.character(annotation$view_id %||% ""))
    intent <- as.character(annotation$intent %||% "other")
    selector <- annotation$selector
    status <- "applied"
    note <- "rendered as a deterministic overlay"

    if (!layout %in% result$layout) {
      status <- "skipped"
      note <- "view layout is not part of this run"
    } else if (intent %in% c("hide", "compare")) {
      status <- "deferred"
      note <- paste0("`", intent, "` requires an agent or explicit parameter change")
    } else if (!is.list(selector) || !selector$kind %in% c("tip", "clade")) {
      status <- "deferred"
      note <- "free point/region/stroke feedback requires agent interpretation or a bounded run plan"
    } else {
      node <- suppressWarnings(as.integer(selector$node))
      base_plot <- result$base_plots[[layout]]
      row <- as.data.frame(base_plot$data)
      row <- row[row$node == node, , drop = FALSE]
      if (nrow(row) != 1L) {
        status <- "skipped"
        note <- "selector node is absent after rerun"
      } else {
        color <- .feedback_color(intent)
        decorate_plot <- function(plot) {
          plot_row <- as.data.frame(plot$data)
          plot_row <- plot_row[plot_row$node == node, , drop = FALSE]
          if (nrow(plot_row) != 1L) return(plot)
          if (identical(selector$kind, "clade") && identical(intent, "highlight")) {
            plot <- plot + ggtree::geom_hilight(node = node, fill = color, alpha = 0.16)
          }
          plot <- plot + ggplot2::geom_point(
            data = plot_row, ggplot2::aes(x = x, y = y), inherit.aes = FALSE,
            shape = 21, size = 4.2, stroke = 1.3, color = color, fill = "white"
          )
          if (intent %in% c("label", "question", "other")) {
            plot <- plot + ggplot2::geom_label(
              data = plot_row,
              ggplot2::aes(x = x, y = y,
                           label = .feedback_short_label(i, annotation$instruction)),
              inherit.aes = FALSE, color = color, fill = "white",
              label.size = 0.25, size = 2.8, hjust = -0.05
            )
          }
          plot
        }
        result$base_plots[[layout]] <- decorate_plot(result$base_plots[[layout]])
        if (!is.null(result$intent_plots[[layout]])) {
          result$intent_plots[[layout]] <- decorate_plot(result$intent_plots[[layout]])
        }
        if (!is.null(result$annotated_plots[[layout]])) {
          result$annotated_plots[[layout]] <- decorate_plot(result$annotated_plots[[layout]])
        }
      }
    }
    status_rows[[i]] <- data.frame(id = id, status = status, note = note,
                                   stringsAsFactors = FALSE)
  }
  result$parameters$feedback_count <- length(feedback$annotations)
  list(result = result, status = do.call(rbind, status_rows))
}
