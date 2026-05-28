import UIKit
import Capacitor
import Foundation
import MobileVLCKit

@objc(Iptvplayer)
public class Iptvplayer: CAPPlugin {

    @objc func play(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url") else {
            call.reject("Must provide a URL")
            return
        }
        let title = call.getString("title") ?? ""
        let mode = call.getString("mode") ?? "vod"

        // Channel list for live mode
        var channelList: [[String: String]] = []
        let currentIdx = call.getInt("currentIndex") ?? 0
        if let rawChannels = call.getArray("channels") as? [JSObject] {
            for ch in rawChannels {
                let name = ch["name"] as? String ?? ""
                let url = ch["url"] as? String ?? ""
                channelList.append(["name": name, "url": url])
            }
        }

        DispatchQueue.main.async {
            let playerVC = VLCPlayerViewController()
            playerVC.videoURL = URL(string: urlString)
            playerVC.streamTitle = title
            playerVC.isLiveMode = (mode == "live")
            playerVC.channelList = channelList
            playerVC.currentChannelIndex = currentIdx
            playerVC.modalPresentationStyle = .fullScreen

            if let rootVC = self.bridge?.viewController {
                rootVC.present(playerVC, animated: true) {
                    call.resolve(["status": "success"])
                }
            } else {
                call.reject("Could not find root view controller")
            }
        }
    }
}

// MARK: - Player VC

class VLCPlayerViewController: UIViewController, VLCMediaPlayerDelegate {

    // Config
    private let crimson = UIColor(red: 253.0/255, green: 49.0/255, blue: 48.0/255, alpha: 1)
    private let autoHideSec: TimeInterval = 4.0

    // Public
    var videoURL: URL?
    var streamTitle: String = ""
    var isLiveMode: Bool = false
    var channelList: [[String: String]] = []
    var currentChannelIndex: Int = 0

    // State
    private var mediaPlayer = VLCMediaPlayer()
    private var isDragging = false
    private var hideTimer: Timer?
    private var didStart = false
    private var controlsVisible = true

    // Views
    private let videoView = UIView()
    private let gestureView = UIView()
    private let overlayView = UIView()
    private let topGrad = CAGradientLayer()
    private let bottomGrad = CAGradientLayer()

    // Top
    private let backBtn = UIButton(type: .system)
    private let titleLbl = UILabel()
    private let liveBadge = UILabel()

    // Center
    private let centerStack = UIStackView()
    private let leftBtn = UIButton(type: .custom)
    private let mainBtn = UIButton(type: .custom)
    private let rightBtn = UIButton(type: .custom)

    // Bottom
    private let timeLbl = UILabel()
    private let durLbl = UILabel()
    private let slider = UISlider()
    private let bottomBar = UIView()

    // Spinner
    private let spinner = UIActivityIndicatorView(style: .large)

    // Track selection
    private let audioBtn = UIButton(type: .custom)
    private let subBtn = UIButton(type: .custom)
    private let trackOverlay = UIView()
    private let trackSheet = UIView()
    private let trackTitleLbl = UILabel()
    private let trackScroll = UIScrollView()
    private let trackStack = UIStackView()
    private var showingTrackType = 0 // 0=audio 1=sub
    private var tracksChecked = false
    private var trackRetryTimer: Timer?

    // Orientation
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .landscapeLeft }
    override var shouldAutorotate: Bool { true }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildUI()
        setupGestures()
        mediaPlayer.drawable = videoView
        mediaPlayer.delegate = self
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard let url = videoURL, !didStart else { return }
        didStart = true
        startPlayback(url: url)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        topGrad.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: 100)
        bottomGrad.frame = CGRect(x: 0, y: view.bounds.height - 100, width: view.bounds.width, height: 100)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        mediaPlayer.stop()
        hideTimer?.invalidate()
        trackRetryTimer?.invalidate()
    }

    deinit { hideTimer?.invalidate(); trackRetryTimer?.invalidate() }

    // MARK: - Build UI

    private func buildUI() {
        // Video
        videoView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(videoView)
        pin(videoView, to: view)

        // Gesture
        gestureView.translatesAutoresizingMaskIntoConstraints = false
        gestureView.backgroundColor = .clear
        view.addSubview(gestureView)
        pin(gestureView, to: view)

        // Overlay
        overlayView.translatesAutoresizingMaskIntoConstraints = false
        overlayView.backgroundColor = UIColor(white: 0, alpha: 0.35)
        view.addSubview(overlayView)
        pin(overlayView, to: view)

        // Gradients
        topGrad.colors = [UIColor.black.cgColor, UIColor.clear.cgColor]
        bottomGrad.colors = [UIColor.clear.cgColor, UIColor.black.cgColor]
        overlayView.layer.addSublayer(topGrad)
        overlayView.layer.addSublayer(bottomGrad)

        buildTopBar()
        buildCenter()
        buildBottom()

        // Spinner
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.color = .white
        spinner.hidesWhenStopped = true
        view.addSubview(spinner)
        spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor).isActive = true
        spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor).isActive = true

        if !isLiveMode { buildTrackPanel() }
    }

    private func buildTopBar() {
        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        overlayView.addSubview(bar)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
            bar.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            bar.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            bar.heightAnchor.constraint(equalToConstant: 44)
        ])

        // Back - use drawn chevron since SF Symbols may not render
        backBtn.translatesAutoresizingMaskIntoConstraints = false
        backBtn.setTitle("✕", for: .normal)
        backBtn.titleLabel?.font = .systemFont(ofSize: 20, weight: .medium)
        backBtn.setTitleColor(.white, for: .normal)
        backBtn.backgroundColor = UIColor(white: 0.15, alpha: 0.8)
        backBtn.layer.cornerRadius = 22
        backBtn.clipsToBounds = true
        backBtn.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        bar.addSubview(backBtn)
        NSLayoutConstraint.activate([
            backBtn.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
            backBtn.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            backBtn.widthAnchor.constraint(equalToConstant: 44),
            backBtn.heightAnchor.constraint(equalToConstant: 44)
        ])

        // Title
        titleLbl.translatesAutoresizingMaskIntoConstraints = false
        titleLbl.text = streamTitle.isEmpty ? "Playing" : streamTitle
        titleLbl.textColor = .white
        titleLbl.font = .systemFont(ofSize: 16, weight: .semibold)
        titleLbl.textAlignment = .center
        titleLbl.lineBreakMode = .byTruncatingTail
        bar.addSubview(titleLbl)
        NSLayoutConstraint.activate([
            titleLbl.leadingAnchor.constraint(equalTo: backBtn.trailingAnchor, constant: 12),
            titleLbl.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -120),
            titleLbl.centerYAnchor.constraint(equalTo: bar.centerYAnchor)
        ])

        // Live badge
        liveBadge.translatesAutoresizingMaskIntoConstraints = false
        liveBadge.text = "  LIVE  "
        liveBadge.textColor = .white
        liveBadge.font = .systemFont(ofSize: 11, weight: .heavy)
        liveBadge.backgroundColor = crimson
        liveBadge.layer.cornerRadius = 4
        liveBadge.clipsToBounds = true
        liveBadge.isHidden = !isLiveMode
        bar.addSubview(liveBadge)
        NSLayoutConstraint.activate([
            liveBadge.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
            liveBadge.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            liveBadge.heightAnchor.constraint(equalToConstant: 22)
        ])

        // Audio & Subtitle buttons (VOD only)
        for (btn, title) in [(subBtn, "SUB"), (audioBtn, "AUD")] {
            btn.translatesAutoresizingMaskIntoConstraints = false
            btn.setTitle(title, for: .normal)
            btn.titleLabel?.font = .systemFont(ofSize: 11, weight: .bold)
            btn.setTitleColor(.white, for: .normal)
            btn.backgroundColor = UIColor(white: 0.15, alpha: 0.8)
            btn.layer.cornerRadius = 14
            btn.clipsToBounds = true
            btn.isHidden = true
            bar.addSubview(btn)
        }
        audioBtn.addTarget(self, action: #selector(audioTapped), for: .touchUpInside)
        subBtn.addTarget(self, action: #selector(subTapped), for: .touchUpInside)
        NSLayoutConstraint.activate([
            subBtn.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
            subBtn.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            subBtn.widthAnchor.constraint(equalToConstant: 44),
            subBtn.heightAnchor.constraint(equalToConstant: 28),
            audioBtn.trailingAnchor.constraint(equalTo: subBtn.leadingAnchor, constant: -6),
            audioBtn.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            audioBtn.widthAnchor.constraint(equalToConstant: 44),
            audioBtn.heightAnchor.constraint(equalToConstant: 28)
        ])
    }

    private func buildCenter() {
        centerStack.translatesAutoresizingMaskIntoConstraints = false
        centerStack.axis = .horizontal
        centerStack.spacing = 48
        centerStack.alignment = .center
        overlayView.addSubview(centerStack)
        NSLayoutConstraint.activate([
            centerStack.centerXAnchor.constraint(equalTo: overlayView.centerXAnchor),
            centerStack.centerYAnchor.constraint(equalTo: overlayView.centerYAnchor)
        ])

        // Left button: backward (VOD) or prev channel (Live)
        makeCircleBtn(leftBtn, size: 52)
        leftBtn.addTarget(self, action: #selector(leftAction), for: .touchUpInside)
        centerStack.addArrangedSubview(leftBtn)

        // Center: play/pause
        makeCircleBtn(mainBtn, size: 72)
        mainBtn.addTarget(self, action: #selector(playPauseTapped), for: .touchUpInside)
        centerStack.addArrangedSubview(mainBtn)

        // Right button: forward (VOD) or next channel (Live)
        makeCircleBtn(rightBtn, size: 52)
        rightBtn.addTarget(self, action: #selector(rightAction), for: .touchUpInside)
        centerStack.addArrangedSubview(rightBtn)

        // Set initial icons
        applyIcons()
    }

    private func buildBottom() {
        bottomBar.translatesAutoresizingMaskIntoConstraints = false
        overlayView.addSubview(bottomBar)
        let safe = view.safeAreaLayoutGuide

        // In live mode, hide seek controls entirely
        bottomBar.isHidden = isLiveMode

        NSLayoutConstraint.activate([
            bottomBar.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            bottomBar.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            bottomBar.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -12),
            bottomBar.heightAnchor.constraint(equalToConstant: 48)
        ])

        timeLbl.translatesAutoresizingMaskIntoConstraints = false
        timeLbl.text = "00:00"
        timeLbl.textColor = .white
        timeLbl.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        bottomBar.addSubview(timeLbl)

        durLbl.translatesAutoresizingMaskIntoConstraints = false
        durLbl.text = "00:00"
        durLbl.textColor = UIColor(white: 1, alpha: 0.7)
        durLbl.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        bottomBar.addSubview(durLbl)

        slider.translatesAutoresizingMaskIntoConstraints = false
        slider.minimumTrackTintColor = crimson
        slider.maximumTrackTintColor = UIColor(white: 1.0, alpha: 0.2)
        slider.setThumbImage(makeThumb(14), for: .normal)
        slider.setThumbImage(makeThumb(20), for: .highlighted)
        slider.addTarget(self, action: #selector(sliderDown), for: .touchDown)
        slider.addTarget(self, action: #selector(sliderChanged), for: .valueChanged)
        slider.addTarget(self, action: #selector(sliderUp), for: [.touchUpInside, .touchUpOutside])
        bottomBar.addSubview(slider)

        NSLayoutConstraint.activate([
            timeLbl.leadingAnchor.constraint(equalTo: bottomBar.leadingAnchor),
            timeLbl.centerYAnchor.constraint(equalTo: bottomBar.centerYAnchor),
            slider.leadingAnchor.constraint(equalTo: timeLbl.trailingAnchor, constant: 10),
            slider.trailingAnchor.constraint(equalTo: durLbl.leadingAnchor, constant: -10),
            slider.centerYAnchor.constraint(equalTo: bottomBar.centerYAnchor),
            durLbl.trailingAnchor.constraint(equalTo: bottomBar.trailingAnchor),
            durLbl.centerYAnchor.constraint(equalTo: bottomBar.centerYAnchor)
        ])
    }

    // MARK: - Track Selection Panel

    private func buildTrackPanel() {
        // Full-screen overlay
        trackOverlay.translatesAutoresizingMaskIntoConstraints = false
        trackOverlay.backgroundColor = UIColor(white: 0, alpha: 0.5)
        trackOverlay.alpha = 0
        trackOverlay.isHidden = true
        view.addSubview(trackOverlay)
        pin(trackOverlay, to: view)
        trackOverlay.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(hideTrackPanel)))

        // Bottom sheet — fixed 50% height
        trackSheet.translatesAutoresizingMaskIntoConstraints = false
        trackSheet.backgroundColor = UIColor(red: 10/255, green: 20/255, blue: 46/255, alpha: 0.97)
        trackSheet.layer.cornerRadius = 16
        trackSheet.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        trackSheet.clipsToBounds = true
        trackOverlay.addSubview(trackSheet)

        // Title
        trackTitleLbl.translatesAutoresizingMaskIntoConstraints = false
        trackTitleLbl.font = .systemFont(ofSize: 16, weight: .bold)
        trackTitleLbl.textColor = .white
        trackSheet.addSubview(trackTitleLbl)

        // Close button
        let closeBtn = UIButton(type: .system)
        closeBtn.translatesAutoresizingMaskIntoConstraints = false
        closeBtn.setTitle("\u{2715}", for: .normal)
        closeBtn.setTitleColor(.white, for: .normal)
        closeBtn.titleLabel?.font = .systemFont(ofSize: 18, weight: .medium)
        closeBtn.addTarget(self, action: #selector(hideTrackPanel), for: .touchUpInside)
        trackSheet.addSubview(closeBtn)

        // Scrollable track list
        trackScroll.translatesAutoresizingMaskIntoConstraints = false
        trackScroll.showsVerticalScrollIndicator = true
        trackScroll.alwaysBounceVertical = true
        trackSheet.addSubview(trackScroll)

        trackStack.translatesAutoresizingMaskIntoConstraints = false
        trackStack.axis = .vertical
        trackStack.spacing = 2
        trackStack.alignment = .fill
        trackScroll.addSubview(trackStack)

        NSLayoutConstraint.activate([
            // Sheet: pinned to bottom, 50% of screen height
            trackSheet.leadingAnchor.constraint(equalTo: trackOverlay.leadingAnchor),
            trackSheet.trailingAnchor.constraint(equalTo: trackOverlay.trailingAnchor),
            trackSheet.bottomAnchor.constraint(equalTo: trackOverlay.bottomAnchor),
            trackSheet.heightAnchor.constraint(equalTo: trackOverlay.heightAnchor, multiplier: 0.5),

            // Title
            trackTitleLbl.topAnchor.constraint(equalTo: trackSheet.topAnchor, constant: 16),
            trackTitleLbl.leadingAnchor.constraint(equalTo: trackSheet.leadingAnchor, constant: 20),

            // Close
            closeBtn.topAnchor.constraint(equalTo: trackSheet.topAnchor, constant: 12),
            closeBtn.trailingAnchor.constraint(equalTo: trackSheet.trailingAnchor, constant: -16),
            closeBtn.widthAnchor.constraint(equalToConstant: 32),
            closeBtn.heightAnchor.constraint(equalToConstant: 32),

            // Scroll view: fills space below title, anchored to TRACKSHEET (not view)
            trackScroll.topAnchor.constraint(equalTo: trackTitleLbl.bottomAnchor, constant: 12),
            trackScroll.leadingAnchor.constraint(equalTo: trackSheet.leadingAnchor),
            trackScroll.trailingAnchor.constraint(equalTo: trackSheet.trailingAnchor),
            trackScroll.bottomAnchor.constraint(equalTo: trackSheet.bottomAnchor, constant: -8),

            // Stack inside scroll: defines scroll content size
            trackStack.topAnchor.constraint(equalTo: trackScroll.contentLayoutGuide.topAnchor),
            trackStack.leadingAnchor.constraint(equalTo: trackScroll.contentLayoutGuide.leadingAnchor),
            trackStack.trailingAnchor.constraint(equalTo: trackScroll.contentLayoutGuide.trailingAnchor),
            trackStack.bottomAnchor.constraint(equalTo: trackScroll.contentLayoutGuide.bottomAnchor),
            trackStack.widthAnchor.constraint(equalTo: trackScroll.frameLayoutGuide.widthAnchor)
        ])
    }

    @objc private func audioTapped() { showingTrackType = 0; showTrackPanel() }
    @objc private func subTapped() { showingTrackType = 1; showTrackPanel() }

    private func showTrackPanel() {
        hideTimer?.invalidate()
        trackRetryTimer?.invalidate()
        populateTracks()
        trackOverlay.isHidden = false
        trackSheet.transform = CGAffineTransform(translationX: 0, y: 300)
        UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.9, initialSpringVelocity: 0.5, options: .curveEaseOut, animations: {
            self.trackOverlay.alpha = 1
            self.trackSheet.transform = .identity
        })
    }

    @objc private func hideTrackPanel() {
        trackRetryTimer?.invalidate()
        trackRetryTimer = nil
        UIView.animate(withDuration: 0.2, animations: {
            self.trackOverlay.alpha = 0
            self.trackSheet.transform = CGAffineTransform(translationX: 0, y: 300)
        }) { _ in self.trackOverlay.isHidden = true }
        resetHideTimer()
    }

    private func populateTracks() {
        trackStack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        // Debug: log what VLC returns
        let audioNames = mediaPlayer.audioTrackNames
        let audioIdxs = mediaPlayer.audioTrackIndexes
        let subNames = mediaPlayer.videoSubTitlesNames
        let subIdxs = mediaPlayer.videoSubTitlesIndexes
        NSLog("[EliteTV] audioTrackNames=%@, audioTrackIndexes=%@", "\(audioNames ?? [])", "\(audioIdxs ?? [])")
        NSLog("[EliteTV] videoSubTitlesNames=%@, videoSubTitlesIndexes=%@", "\(subNames ?? [])", "\(subIdxs ?? [])")
        NSLog("[EliteTV] numberOfAudioTracks=%d, numberOfSubtitlesTracks=%d", mediaPlayer.numberOfAudioTracks, mediaPlayer.numberOfSubtitlesTracks)

        if showingTrackType == 0 {
            trackTitleLbl.text = "Audio Tracks"
            let names = audioNames as? [Any] ?? []
            let indexes = audioIdxs as? [Any] ?? []
            NSLog("[EliteTV] Audio: names.count=%d, indexes.count=%d", names.count, indexes.count)
            if names.isEmpty {
                addTrackRow("Loading audio tracks...", id: -999, active: false)
                scheduleTrackRetry()
                return
            }
            trackRetryTimer?.invalidate()
            let cur = mediaPlayer.currentAudioTrackIndex
            for i in 0..<min(names.count, indexes.count) {
                let name = "\(names[i])"
                let id = (indexes[i] as? NSNumber)?.int32Value ?? Int32(i)
                let display = (name.isEmpty || name == "<null>" || name == "(null)") ? "Audio Track \(i)" : name
                NSLog("[EliteTV] Adding audio row: %@ id=%d active=%d", display, id, id == cur ? 1 : 0)
                addTrackRow(display, id: id, active: id == cur)
            }
        } else {
            trackTitleLbl.text = "Subtitles"
            let names = subNames as? [Any] ?? []
            let indexes = subIdxs as? [Any] ?? []
            NSLog("[EliteTV] Subs: names.count=%d, indexes.count=%d", names.count, indexes.count)
            if names.isEmpty {
                addTrackRow("Loading subtitles...", id: -999, active: false)
                scheduleTrackRetry()
                return
            }
            trackRetryTimer?.invalidate()
            let cur = mediaPlayer.currentVideoSubTitleIndex
            for i in 0..<min(names.count, indexes.count) {
                let name = "\(names[i])"
                let id = (indexes[i] as? NSNumber)?.int32Value ?? Int32(i)
                let display = (name.isEmpty || name == "<null>" || name == "(null)") ? "Subtitle Track \(i)" : name
                NSLog("[EliteTV] Adding sub row: %@ id=%d active=%d", display, id, id == cur ? 1 : 0)
                addTrackRow(display, id: id, active: id == cur)
            }
        }
    }

    private func scheduleTrackRetry() {
        trackRetryTimer?.invalidate()
        trackRetryTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] timer in
            guard let s = self, !s.trackOverlay.isHidden else {
                timer.invalidate()
                return
            }
            NSLog("[EliteTV] Retrying track load...")
            s.populateTracks()
        }
    }

    private func addTrackRow(_ name: String, id: Int32, active: Bool) {
        let row = UIButton(type: .custom)
        row.translatesAutoresizingMaskIntoConstraints = false
        row.contentHorizontalAlignment = .left

        let mark = active ? "\u{25cf}" : "\u{25cb}"
        let title = "   \(mark)   \(name)"
        row.setTitle(title, for: .normal)
        row.setTitleColor(active ? .white : UIColor(white: 0.8, alpha: 1), for: .normal)
        row.titleLabel?.font = .systemFont(ofSize: 15, weight: active ? .semibold : .regular)
        if active {
            row.backgroundColor = UIColor(red: 253/255, green: 49/255, blue: 48/255, alpha: 0.2)
        }
        row.tag = Int(id)
        row.addTarget(self, action: #selector(trackRowTapped(_:)), for: .touchUpInside)
        row.heightAnchor.constraint(equalToConstant: 44).isActive = true
        trackStack.addArrangedSubview(row)
    }

    @objc private func trackRowTapped(_ sender: UIButton) {
        let id = Int32(sender.tag)
        if id == -999 { return }
        if showingTrackType == 0 { mediaPlayer.currentAudioTrackIndex = id }
        else { mediaPlayer.currentVideoSubTitleIndex = id }
        populateTracks()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.hideTrackPanel() }
    }

    private func refreshTrackBtns() {
        guard !isLiveMode else { return }
        audioBtn.isHidden = false
        subBtn.isHidden = false
        tracksChecked = true
    }

    // MARK: - Icon Helpers

    private func applyIcons() {
        // Play/Pause - draw programmatically for reliability
        setPlayIcon(playing: false)

        if isLiveMode {
            // Prev / Next channel arrows
            drawPrevIcon(on: leftBtn)
            drawNextIcon(on: rightBtn)
            // Hide left/right if no channel list
            leftBtn.isHidden = channelList.count < 2
            rightBtn.isHidden = channelList.count < 2
        } else {
            // Backward / Forward 10s
            drawBackwardIcon(on: leftBtn)
            drawForwardIcon(on: rightBtn)
        }
    }

    private func setPlayIcon(playing: Bool) {
        // Remove old sublayers
        mainBtn.layer.sublayers?.filter { $0 is CAShapeLayer }.forEach { $0.removeFromSuperlayer() }

        let shape = CAShapeLayer()
        shape.fillColor = UIColor.white.cgColor
        let path = UIBezierPath()
        let cx: CGFloat = 36, cy: CGFloat = 36

        if playing {
            // Pause icon: two vertical bars
            path.move(to: CGPoint(x: cx - 9, y: cy - 12))
            path.addLine(to: CGPoint(x: cx - 4, y: cy - 12))
            path.addLine(to: CGPoint(x: cx - 4, y: cy + 12))
            path.addLine(to: CGPoint(x: cx - 9, y: cy + 12))
            path.close()
            path.move(to: CGPoint(x: cx + 4, y: cy - 12))
            path.addLine(to: CGPoint(x: cx + 9, y: cy - 12))
            path.addLine(to: CGPoint(x: cx + 9, y: cy + 12))
            path.addLine(to: CGPoint(x: cx + 4, y: cy + 12))
            path.close()
        } else {
            // Play triangle
            path.move(to: CGPoint(x: cx - 8, y: cy - 14))
            path.addLine(to: CGPoint(x: cx + 14, y: cy))
            path.addLine(to: CGPoint(x: cx - 8, y: cy + 14))
            path.close()
        }
        shape.path = path.cgPath
        mainBtn.layer.addSublayer(shape)
    }

    private func drawBackwardIcon(on btn: UIButton) {
        btn.layer.sublayers?.filter { $0 is CAShapeLayer }.forEach { $0.removeFromSuperlayer() }
        let shape = CAShapeLayer()
        shape.fillColor = UIColor.white.cgColor
        let path = UIBezierPath()
        let cx: CGFloat = 26, cy: CGFloat = 26
        // Left-pointing triangle
        path.move(to: CGPoint(x: cx + 2, y: cy - 10))
        path.addLine(to: CGPoint(x: cx - 10, y: cy))
        path.addLine(to: CGPoint(x: cx + 2, y: cy + 10))
        path.close()
        // Second triangle
        path.move(to: CGPoint(x: cx + 12, y: cy - 10))
        path.addLine(to: CGPoint(x: cx + 2, y: cy))
        path.addLine(to: CGPoint(x: cx + 12, y: cy + 10))
        path.close()
        shape.path = path.cgPath
        btn.layer.addSublayer(shape)
    }

    private func drawForwardIcon(on btn: UIButton) {
        btn.layer.sublayers?.filter { $0 is CAShapeLayer }.forEach { $0.removeFromSuperlayer() }
        let shape = CAShapeLayer()
        shape.fillColor = UIColor.white.cgColor
        let path = UIBezierPath()
        let cx: CGFloat = 26, cy: CGFloat = 26
        // Right-pointing triangle
        path.move(to: CGPoint(x: cx - 2, y: cy - 10))
        path.addLine(to: CGPoint(x: cx + 10, y: cy))
        path.addLine(to: CGPoint(x: cx - 2, y: cy + 10))
        path.close()
        // Second triangle
        path.move(to: CGPoint(x: cx - 12, y: cy - 10))
        path.addLine(to: CGPoint(x: cx - 2, y: cy))
        path.addLine(to: CGPoint(x: cx - 12, y: cy + 10))
        path.close()
        shape.path = path.cgPath
        btn.layer.addSublayer(shape)
    }

    private func drawPrevIcon(on btn: UIButton) {
        btn.layer.sublayers?.filter { $0 is CAShapeLayer }.forEach { $0.removeFromSuperlayer() }
        let shape = CAShapeLayer()
        shape.fillColor = UIColor.white.cgColor
        let path = UIBezierPath()
        let cx: CGFloat = 26, cy: CGFloat = 26
        // Bar + triangle (skip prev)
        path.append(UIBezierPath(rect: CGRect(x: cx - 12, y: cy - 10, width: 3, height: 20)))
        path.move(to: CGPoint(x: cx - 6, y: cy))
        path.addLine(to: CGPoint(x: cx + 12, y: cy - 12))
        path.addLine(to: CGPoint(x: cx + 12, y: cy + 12))
        path.close()
        shape.path = path.cgPath
        btn.layer.addSublayer(shape)
    }

    private func drawNextIcon(on btn: UIButton) {
        btn.layer.sublayers?.filter { $0 is CAShapeLayer }.forEach { $0.removeFromSuperlayer() }
        let shape = CAShapeLayer()
        shape.fillColor = UIColor.white.cgColor
        let path = UIBezierPath()
        let cx: CGFloat = 26, cy: CGFloat = 26
        // Triangle + bar (skip next)
        path.move(to: CGPoint(x: cx - 12, y: cy - 12))
        path.addLine(to: CGPoint(x: cx + 6, y: cy))
        path.addLine(to: CGPoint(x: cx - 12, y: cy + 12))
        path.close()
        path.append(UIBezierPath(rect: CGRect(x: cx + 9, y: cy - 10, width: 3, height: 20)))
        shape.path = path.cgPath
        btn.layer.addSublayer(shape)
    }

    private func makeCircleBtn(_ btn: UIButton, size: CGFloat) {
        btn.translatesAutoresizingMaskIntoConstraints = false
        btn.backgroundColor = UIColor(white: 0.15, alpha: 0.7)
        btn.layer.cornerRadius = size / 2
        btn.clipsToBounds = true
        btn.widthAnchor.constraint(equalToConstant: size).isActive = true
        btn.heightAnchor.constraint(equalToConstant: size).isActive = true
    }

    private func makeThumb(_ size: CGFloat) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { ctx in
            UIColor.white.setFill()
            ctx.cgContext.fillEllipse(in: CGRect(x: 0, y: 0, width: size, height: size))
        }
    }

    private func pin(_ child: UIView, to parent: UIView) {
        NSLayoutConstraint.activate([
            child.topAnchor.constraint(equalTo: parent.topAnchor),
            child.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
            child.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
            child.trailingAnchor.constraint(equalTo: parent.trailingAnchor)
        ])
    }

    // MARK: - Gestures

    private func setupGestures() {
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        gestureView.addGestureRecognizer(doubleTap)

        let singleTap = UITapGestureRecognizer(target: self, action: #selector(handleSingleTap))
        singleTap.numberOfTapsRequired = 1
        singleTap.require(toFail: doubleTap)
        gestureView.addGestureRecognizer(singleTap)
    }

    // MARK: - Actions

    @objc private func handleSingleTap() {
        if controlsVisible { hideControls() } else { showControls() }
    }

    @objc private func handleDoubleTap(_ g: UITapGestureRecognizer) {
        let loc = g.location(in: gestureView)
        let isLeft = loc.x < gestureView.bounds.midX
        if isLiveMode {
            // Double tap = switch channel
            if isLeft { switchChannel(delta: -1) } else { switchChannel(delta: 1) }
        } else {
            // Double tap = seek ±10s
            if isLeft { seekBy(seconds: -10) } else { seekBy(seconds: 10) }
        }
    }

    @objc private func playPauseTapped() {
        resetHideTimer()
        if mediaPlayer.isPlaying {
            mediaPlayer.pause()
            setPlayIcon(playing: false)
        } else {
            mediaPlayer.play()
            setPlayIcon(playing: true)
        }
    }

    @objc private func leftAction() {
        resetHideTimer()
        if isLiveMode { switchChannel(delta: -1) } else { seekBy(seconds: -10) }
    }

    @objc private func rightAction() {
        resetHideTimer()
        if isLiveMode { switchChannel(delta: 1) } else { seekBy(seconds: 10) }
    }

    @objc private func closeTapped() {
        mediaPlayer.stop()
        hideTimer?.invalidate()
        dismiss(animated: true)
    }

    // MARK: - Seek (VOD only)

    private func seekBy(seconds: Int) {
        let curMs = mediaPlayer.time.intValue
        let totMs = mediaPlayer.media?.length.intValue ?? 0
        guard totMs > 0 else { return }
        let newMs = curMs + Int32(seconds * 1000)
        mediaPlayer.position = max(0, min(1, Float(newMs) / Float(totMs)))
    }

    // MARK: - Channel Switch (Live only)

    private var isSwitching = false

    private func switchChannel(delta: Int) {
        guard channelList.count >= 2, !isSwitching else { return }

        var newIdx = currentChannelIndex + delta
        if newIdx < 0 { newIdx = channelList.count - 1 }
        if newIdx >= channelList.count { newIdx = 0 }
        currentChannelIndex = newIdx

        let ch = channelList[newIdx]
        guard let urlStr = ch["url"], let url = URL(string: urlStr) else { return }

        // Update title immediately
        titleLbl.text = ch["name"] ?? "Channel \(newIdx + 1)"
        spinner.startAnimating()
        isSwitching = true

        // Stop old stream on background thread to avoid blocking main
        let oldPlayer = mediaPlayer
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            oldPlayer.delegate = nil
            oldPlayer.stop()
            oldPlayer.media = nil  // Release old media + network connection

            DispatchQueue.main.async {
                guard let s = self else { return }
                // Assign new media with low cache for fast live start
                let media = VLCMedia(url: url)
                media.addOptions(["network-caching": 1000])
                s.mediaPlayer.delegate = s
                s.mediaPlayer.media = media
                s.mediaPlayer.play()
                s.showControls()

                // Reset debounce after a short delay
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    s.isSwitching = false
                }
            }
        }
    }

    // MARK: - Slider

    @objc private func sliderDown() { isDragging = true; hideTimer?.invalidate() }

    @objc private func sliderChanged() {
        let totMs = mediaPlayer.media?.length.intValue ?? 0
        if totMs > 0 { timeLbl.text = fmtTime(Int32(slider.value * Float(totMs))) }
    }

    @objc private func sliderUp() {
        mediaPlayer.position = slider.value
        isDragging = false
        resetHideTimer()
    }

    // MARK: - Overlay

    private func showControls() {
        controlsVisible = true
        UIView.animate(withDuration: 0.25) { self.overlayView.alpha = 1 }
        resetHideTimer()
    }

    private func hideControls() {
        controlsVisible = false
        UIView.animate(withDuration: 0.3) { self.overlayView.alpha = 0 }
        hideTimer?.invalidate()
    }

    private func resetHideTimer() {
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: autoHideSec, repeats: false) { [weak self] _ in
            DispatchQueue.main.async {
                guard let s = self, s.mediaPlayer.isPlaying, !s.isDragging else { return }
                s.hideControls()
            }
        }
    }

    // MARK: - Playback

    private func startPlayback(url: URL) {
        let media = VLCMedia(url: url)
        media.addOptions(["network-caching": 3000])
        mediaPlayer.media = media
        mediaPlayer.play()
        spinner.startAnimating()
        showControls()

        // VLC parses tracks automatically during playback.
        // The retry timer in populateTracks() handles waiting
        // for tracks to become available.
    }

    // MARK: - VLC Delegate

    func mediaPlayerTimeChanged(_ aNotification: Notification!) {
        guard !isDragging else { return }
        DispatchQueue.main.async { [weak self] in
            guard let s = self else { return }
            if s.spinner.isAnimating {
                s.spinner.stopAnimating()
                s.setPlayIcon(playing: true)
            }
            if !s.tracksChecked { s.refreshTrackBtns() }
            let curMs = s.mediaPlayer.time.intValue
            let totMs = s.mediaPlayer.media?.length.intValue ?? 0
            if totMs > 0 && !s.isLiveMode {
                s.slider.value = Float(curMs) / Float(totMs)
                s.timeLbl.text = s.fmtTime(curMs)
                s.durLbl.text = s.fmtTime(totMs)
            } else {
                s.timeLbl.text = s.fmtTime(curMs)
            }
        }
    }

    func mediaPlayerStateChanged(_ aNotification: Notification!) {
        DispatchQueue.main.async { [weak self] in
            guard let s = self else { return }
            switch s.mediaPlayer.state {
            case .playing:
                s.spinner.stopAnimating()
                s.setPlayIcon(playing: true)
            case .buffering:
                s.spinner.startAnimating()
            case .ended, .stopped, .error:
                if !s.isLiveMode { s.closeTapped() }
            default: break
            }
        }
    }

    private func fmtTime(_ ms: Int32) -> String {
        let t = max(0, ms / 1000)
        let h = t / 3600, m = (t % 3600) / 60, s = t % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}