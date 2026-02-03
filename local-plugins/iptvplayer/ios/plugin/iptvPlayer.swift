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
        
        DispatchQueue.main.async {
            let playerVC = VLCPlayerViewController()
            if let url = URL(string: urlString) {
                playerVC.videoURL = url
            }
            playerVC.modalPresentationStyle = .fullScreen
            
            if let rootVC = self.bridge?.viewController {
                rootVC.present(playerVC, animated: true, completion: {
                   call.resolve(["status": "success"])
                })
            } else {
                call.reject("Could not find root view controller")
            }
        }
    }
}

class VLCPlayerViewController: UIViewController, VLCMediaPlayerDelegate {
    
    // MARK: - Variables
    var mediaPlayer: VLCMediaPlayer = VLCMediaPlayer()
    var videoURL: URL?
    var isDragging: Bool = false
    var hideTimer: Timer?
    var didStartPlaying: Bool = false
    
    // MARK: - UI Elements
    var videoView: UIView!
    var touchLayer: UIView!    // <--- NEW: Always active transparent layer
    var overlayView: UIView!   // <--- Buttons and UI
    var activityIndicator: UIActivityIndicatorView!
    
    var closeBtn: UIButton!
    var playPauseBtn: UIButton!
    var seekSlider: UISlider!
    var timeLabel: UILabel!
    
    // Forces the player to only use Landscape (Sideways) orientations
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return .landscape
    }

    // Forces the screen to rotate to the left side as soon as it opens
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation {
        return .landscapeLeft
    }

    // Allows the user to flip the phone 180 degrees to the other landscape side
    override var shouldAutorotate: Bool {
        return true
    }

    // MARK: - Lifecycle
    override func viewDidLoad() {
        super.viewDidLoad()
        self.view.backgroundColor = .black
        
        // 1. Setup Video View (Bottom)
        videoView = UIView(frame: self.view.bounds)
        videoView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        videoView.isUserInteractionEnabled = false // Disable touch on video
        self.view.addSubview(videoView)
        
        // 2. Setup Touch Layer (Middle - INVISIBLE BUT ACTIVE)
        // This layer sits above video but below controls. It catches the taps.
        touchLayer = UIView(frame: self.view.bounds)
        touchLayer.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        touchLayer.backgroundColor = .clear 
        self.view.addSubview(touchLayer)
        
        // 3. Setup Overlay View (Top - Controls)
        overlayView = UIView(frame: self.view.bounds)
        overlayView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlayView.backgroundColor = UIColor(white: 0.0, alpha: 0.3)
        self.view.addSubview(overlayView)
        
        // 4. Build UI
        setupOverlayUI()
        
        // 5. Connect VLC
        mediaPlayer.drawable = videoView
        mediaPlayer.delegate = self
        
        // 6. Setup Tap Gesture on the TOUCH LAYER
        let tap = UITapGestureRecognizer(target: self, action: #selector(toggleControls))
        touchLayer.addGestureRecognizer(tap)
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        
        if let url = videoURL, !didStartPlaying {
            didStartPlaying = true
            let media = VLCMedia(url: url)
            media.addOptions(["network-caching": 3000])
            mediaPlayer.media = media
            mediaPlayer.play()
            
            activityIndicator.startAnimating()
            resetHideTimer()
        }
    }
    
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if mediaPlayer.isPlaying {
            mediaPlayer.stop()
        }
        hideTimer?.invalidate()
    }
    
    func setupOverlayUI() {
        // Spinner (On main view so it stays visible)
        activityIndicator = UIActivityIndicatorView(style: .large)
        activityIndicator.color = .white
        activityIndicator.center = self.view.center
        activityIndicator.hidesWhenStopped = true
        self.view.addSubview(activityIndicator)
        
        // Close Button
        closeBtn = UIButton(type: .system)
        closeBtn.frame = CGRect(x: 20, y: 50, width: 80, height: 40)
        closeBtn.setTitle("✕ Close", for: .normal)
        closeBtn.backgroundColor = UIColor(white: 0.1, alpha: 0.8)
        closeBtn.layer.cornerRadius = 20
        closeBtn.setTitleColor(.white, for: .normal)
        closeBtn.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        overlayView.addSubview(closeBtn)

        // Play/Pause
        playPauseBtn = UIButton(type: .system)
        playPauseBtn.frame = CGRect(x: 0, y: 0, width: 90, height: 90)
        playPauseBtn.center = self.view.center
        playPauseBtn.setTitle("⏸", for: .normal)
        playPauseBtn.titleLabel?.font = UIFont.systemFont(ofSize: 50)
        playPauseBtn.setTitleColor(.white, for: .normal)
        playPauseBtn.layer.shadowColor = UIColor.black.cgColor
        playPauseBtn.layer.shadowOpacity = 0.5
        playPauseBtn.layer.shadowRadius = 5
        playPauseBtn.addTarget(self, action: #selector(playPauseTapped), for: .touchUpInside)
        overlayView.addSubview(playPauseBtn)

        // Time Label
        timeLabel = UILabel(frame: CGRect(x: 20, y: self.view.bounds.height - 80, width: 250, height: 30))
        timeLabel.autoresizingMask = [.flexibleTopMargin]
        timeLabel.textColor = .white
        timeLabel.text = "00:00 / 00:00"
        timeLabel.font = UIFont.monospacedDigitSystemFont(ofSize: 14, weight: .regular)
        overlayView.addSubview(timeLabel)

        // Slider
        seekSlider = UISlider(frame: CGRect(x: 20, y: self.view.bounds.height - 50, width: self.view.bounds.width - 40, height: 30))
        seekSlider.autoresizingMask = [.flexibleWidth, .flexibleTopMargin]
        seekSlider.minimumTrackTintColor = .red
        seekSlider.thumbTintColor = .white
        seekSlider.addTarget(self, action: #selector(sliderStarted), for: .touchDown)
        seekSlider.addTarget(self, action: #selector(sliderEnded), for: [.touchUpInside, .touchUpOutside])
        overlayView.addSubview(seekSlider)
    }
    
    // MARK: - Actions
    @objc func toggleControls() {
        DispatchQueue.main.async {
            // FIX: Only toggle alpha. Never set isHidden = true.
            if self.overlayView.alpha == 0 {
                // Show
                UIView.animate(withDuration: 0.2) { self.overlayView.alpha = 1 }
                self.resetHideTimer()
            } else {
                // Hide
                UIView.animate(withDuration: 0.2) { self.overlayView.alpha = 0 }
                self.hideTimer?.invalidate()
            }
        }
    }
    
    func resetHideTimer() {
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: 4.0, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            DispatchQueue.main.async {
                if self.mediaPlayer.isPlaying && !self.isDragging {
                    UIView.animate(withDuration: 0.5) { self.overlayView.alpha = 0 }
                }
            }
        }
    }
    
    @objc func playPauseTapped() {
        resetHideTimer()
        if mediaPlayer.isPlaying {
            mediaPlayer.pause()
            playPauseBtn.setTitle("▶", for: .normal)
        } else {
            mediaPlayer.play()
            playPauseBtn.setTitle("⏸", for: .normal)
        }
    }

    @objc func sliderStarted() {
        isDragging = true
        resetHideTimer()
    }
    
    @objc func sliderEnded() {
        mediaPlayer.position = seekSlider.value
        isDragging = false 
        resetHideTimer()
    }
    
    @objc func closeTapped() {
        if mediaPlayer.isPlaying { mediaPlayer.stop() }
        hideTimer?.invalidate()
        self.dismiss(animated: true, completion: nil)
    }
    
    // MARK: - VLC Delegate
    func mediaPlayerTimeChanged(_ aNotification: Notification!) {
        if isDragging { return }
        
        DispatchQueue.main.async {
            // Force spinner stop here as backup
            if self.activityIndicator.isAnimating {
                self.activityIndicator.stopAnimating()
                self.playPauseBtn.setTitle("⏸", for: .normal)
            }

            let time = self.mediaPlayer.time
            if let length = self.mediaPlayer.media?.length {
                let cur = time.intValue
                let tot = length.intValue
                
                if tot > 0 {
                    let progress = Float(cur) / Float(tot)
                    self.seekSlider.value = progress
                    self.timeLabel.text = "\(self.formatTime(cur)) / \(self.formatTime(tot))"
                }
            }
        }
    }
    
    func mediaPlayerStateChanged(_ aNotification: Notification!) {
        DispatchQueue.main.async {
            if self.mediaPlayer.state == .playing {
                self.activityIndicator.stopAnimating()
                self.playPauseBtn.setTitle("⏸", for: .normal)
            } else if self.mediaPlayer.state == .buffering {
                self.activityIndicator.startAnimating()
            } else if self.mediaPlayer.state == .ended {
                self.closeTapped()
            }
        }
    }

    func formatTime(_ millis: Int32) -> String {
        let totalSeconds = millis / 1000
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60
        
        if hours > 0 {
            return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
        } else {
            return String(format: "%02d:%02d", minutes, seconds)
        }
    }
}