def run(signals, add_transaction, add_region, modify_signal, create_signal):
    """
    Ready/Valid monitor implemented as a sieve.
    Detects transactions when ready=1 and valid=1 at rising clock edge.
    Highlights the transaction cycle - from the capturing clock edge to the next.

    add_region(start_x, end_x, color, signal_name=None, label=None)
      - start_x, end_x: time range in grid units
      - color: CSS color with alpha, e.g., 'rgba(0, 255, 0, 0.3)'
      - signal_name: if set, region only shows on that signal; None = all signals
      - label: optional text label to show in the region
    """
    clk = signals.get('CLK')
    ready = signals.get('READY')
    valid = signals.get('VALID')
    data = signals.get('DATA')

    if not all([clk, ready, valid, data]):
        return  # Required signals not found

    # First, collect all rising clock edges
    rising_edges = []
    for i in range(1, len(clk.points)):
        prev = clk.points[i-1]
        curr = clk.points[i]
        if prev['level'] == 0 and curr['level'] == 1:
            rising_edges.append(curr['x'])

    # Find transactions at each rising edge
    txn_count = 0
    for idx, edge_time in enumerate(rising_edges):
        # Check ready/valid before edge using .value_before() method
        if ready.value_before(edge_time) == 1 and valid.value_before(edge_time) == 1:
            d = data.value_before(edge_time)
            if d is not None:
                txn_count += 1
                add_transaction(edge_time, d)

                # Region starts at this clock edge
                region_start = edge_time - 2

                # Region ends at the NEXT rising clock edge
                # If there's no next edge, extend to the end of the waveform
                if idx + 1 < len(rising_edges):
                    region_end = rising_edges[idx + 1] - 2
                else:
                    # No next edge - extend a bit past the last edge
                    region_end = edge_time  # Default extension

                # Add a translucent red region highlighting the transaction cycle
                # Show on all waveforms
                color = 'rgba(244, 67, 54, 0.3)'
                txn = ""
                if (d == 255):
                    txn = "mov a, b"
                if (d == 12):
                    txn = "ld a, 0x00"
                if (d == 99):
                    txn = "INVALID"
                    color = 'rgba(240, 240, 0, 0.3)'
                
                add_region(
                    region_start,
                    region_end,
                    color,  # Red with 30% opacity
                    None,  # Show on all signals
                    f'T{txn_count}',  # Label with transaction number
                    f'Transaction {txn_count}\nTime: {edge_time}\n{txn}'  # Tooltip with details
                )
